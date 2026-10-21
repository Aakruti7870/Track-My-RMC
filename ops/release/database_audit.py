#!/usr/bin/env python3
"""Read-only PostgreSQL parity audit; outputs counts and schema metadata, never rows.

Run on the existing application host. Credentials stay in the child environment;
neither the connection URI nor psql stderr is emitted. No DDL, backup, restore,
migration, production cutover, or provider call is performed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import parse_qs, quote, unquote, urlsplit, urlunsplit


class AuditError(Exception):
    pass


def database_uri(uri, database=None):
    try:
        parsed = urlsplit(uri)
        name = unquote(parsed.path.lstrip("/"))
        if (parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname
                or not re.fullmatch(r"[A-Za-z0-9_]+", name)):
            raise ValueError()
        if database is not None and not re.fullmatch(r"[A-Za-z0-9_]+", database):
            raise ValueError()
        return name, urlunsplit(parsed._replace(path="/" + quote(database or name, safe="")))
    except (ValueError, TypeError):
        raise AuditError("Invalid PostgreSQL connection configuration") from None


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def query(uri, sql):
    database_uri(uri)
    parsed = urlsplit(uri)
    env = os.environ.copy()
    # PGDATABASE from the environment is not expanded as a libpq URI. Split
    # into libpq environment fields instead; credentials never enter argv.
    sslmode = parse_qs(parsed.query).get("sslmode", ["require"])[0]
    if sslmode not in ("require", "verify-ca", "verify-full"):
        raise AuditError("Database audit requires an encrypted PostgreSQL connection")
    env.update(PGDATABASE=unquote(parsed.path.lstrip("/")), PGHOST=parsed.hostname,
               PGPORT=str(parsed.port or 5432), PGUSER=unquote(parsed.username or ""),
               PGPASSWORD=unquote(parsed.password or ""), PGSSLMODE=sslmode, PGCONNECT_TIMEOUT="5",
               PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000")
    try:
        proc = subprocess.run(
            ["psql", "-X", "-q", "-A", "-t", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"],
            input="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n" + sql + ";\nROLLBACK;\n",
            env=env, capture_output=True, text=True, timeout=90, check=False)
        if proc.returncode:
            codes = re.findall(r"ERROR:\s+([0-9A-Z]{5})\b", proc.stderr)
            raise AuditError("Read-only database query failed" + (" (SQLSTATE " + codes[0] + ")" if codes else ""))
        return json.loads(proc.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        raise AuditError("Read-only database query unavailable or timed out") from None


CATALOG = """
SELECT json_build_object(
 'database',current_database(), 'server_version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),
 'databases',(SELECT json_agg(datname ORDER BY datname) FROM pg_database WHERE NOT datistemplate),
 'tables',(SELECT coalesce(json_agg(c.relname ORDER BY c.relname),'[]')
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')),
 'columns',(SELECT coalesce(json_agg(json_build_array(table_name,column_name,data_type,is_nullable)
   ORDER BY table_name,ordinal_position),'[]') FROM information_schema.columns WHERE table_schema='public'),
 'constraints',(SELECT coalesce(json_agg(json_build_array(c.conrelid::regclass::text,c.conname,c.contype,c.convalidated,
   pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname),'[]')
   FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
 'indexes',(SELECT coalesce(json_agg(json_build_array(t.relname,i.relname,x.indisvalid,x.indisready,pg_get_indexdef(i.oid))
   ORDER BY t.relname,i.relname),'[]') FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
   JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'),
 'foreign_keys',(SELECT coalesce(json_agg(json_build_object('name',c.conname,
   'table',t.relname,'target_schema',rn.nspname,'target',rt.relname,
   'columns',(SELECT json_agg(json_build_array(a.attname,ra.attname) ORDER BY k.ord)
     FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(att,refatt,ord)
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.att
     JOIN pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=k.refatt)) ORDER BY t.relname,c.conname),'[]')
   FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   JOIN pg_class rt ON rt.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=rt.relnamespace
   WHERE n.nspname='public' AND c.contype='f'))
"""


def count_sql(catalog):
    counts = ["SELECT " + literal(t) + " AS name,count(*)::bigint AS count FROM public." + identifier(t)
              for t in catalog["tables"]]
    orphans = []
    for fk in catalog["foreign_keys"]:
        nonnull = " AND ".join("s." + identifier(a) + " IS NOT NULL" for a, _ in fk["columns"])
        joins = " AND ".join("s." + identifier(a) + "=r." + identifier(b) for a, b in fk["columns"])
        orphans.append("SELECT " + literal(fk["table"] + "." + fk["name"]) +
                       " AS name,count(*)::bigint AS count FROM public." + identifier(fk["table"]) +
                       " s WHERE " + nonnull + " AND NOT EXISTS(SELECT 1 FROM " +
                       identifier(fk["target_schema"]) + "." + identifier(fk["target"]) + " r WHERE " + joins + ")")
    def aggregate(parts):
        return "(SELECT coalesce(json_object_agg(name,count),'{}') FROM (" + " UNION ALL ".join(parts) + ") q)" if parts else "'{}'::json"
    migration = ("(SELECT coalesce(json_agg(json_build_object('version',version,'checksum',encode(checksum,'hex'),"
                 "'success',success) ORDER BY version),'[]') FROM public._sqlx_migrations)"
                 if "_sqlx_migrations" in catalog["tables"] else "'[]'::json")
    roles = ("(SELECT coalesce(json_object_agg(role,n),'{}') FROM (SELECT role,count(*) n FROM public.users GROUP BY role) r)"
             if "users" in catalog["tables"] else "'{}'::json")
    return ("SELECT json_build_object('read_only',current_setting('transaction_read_only'),'counts'," +
            aggregate(counts) + ",'orphans'," + aggregate(orphans) + ",'migrations'," + migration +
            ",'roles'," + roles + ")")


def migration_parity(rows, migration_dir):
    expected = {int(p.name.split("_", 1)[0]): hashlib.sha384(p.read_bytes()).hexdigest()
                for p in migration_dir.glob("[0-9]*_*.sql")}
    actual = {row["version"]: row for row in rows}
    return {"expected_count":len(expected), "applied_count":len(actual),
            "missing_versions":sorted(expected.keys() - actual.keys()),
            "unknown_versions":sorted(actual.keys() - expected.keys()),
            "failed_versions":sorted(v for v, r in actual.items() if r["success"] is not True),
            "checksum_mismatch_versions":sorted(v for v in expected.keys() & actual.keys()
                                                if expected[v] != actual[v]["checksum"])}


def inspect(uri, migration_dir):
    catalog = query(uri, CATALOG)
    data = query(uri, count_sql(catalog))
    if catalog["read_only"] != "on" or data["read_only"] != "on":
        raise AuditError("Database audit requires read-only transactions")
    schema = {k: catalog[k] for k in ("columns", "constraints", "indexes")}
    parity = migration_parity(data["migrations"], migration_dir)
    return {"database":catalog["database"], "server_version":catalog["server_version"],
            "databases":catalog["databases"], "table_count":len(catalog["tables"]),
            "schema_sha256":hashlib.sha256(json.dumps(schema,sort_keys=True).encode()).hexdigest(),
            "table_counts":data["counts"], "roles":data["roles"], "migration_parity":parity,
            "unvalidated_constraints":[c[:2] for c in catalog["constraints"] if c[3] is not True],
            "invalid_indexes":[i[:2] for i in catalog["indexes"] if i[2] is not True or i[3] is not True],
            "foreign_key_checks":len(data["orphans"]),
            "foreign_key_orphans":{k:v for k,v in data["orphans"].items() if v},
            "read_only":True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path("/etc/trackmyrmc/app.env"))
    parser.add_argument("--migration-dir", type=Path, default=Path("/opt/trackmyrmc/source/backend/migrations"))
    parser.add_argument("--expected-database", default="trackmyrmc")
    args = parser.parse_args()
    try:
        values = [l.split("=",1)[1].strip().strip('"').strip("'") for l in args.env_file.read_text().splitlines()
                  if l.startswith("DATABASE_URL=")]
        if len(values) != 1 or not args.migration_dir.is_dir():
            raise AuditError("Exactly one runtime connection and a migration directory are required")
        runtime, uri = database_uri(values[0])
        _, intended_uri = database_uri(uri, args.expected_database)
        runtime_report = inspect(uri, args.migration_dir)
        intended_report = runtime_report if runtime == args.expected_database else inspect(intended_uri, args.migration_dir)
        print(json.dumps({"checked_at":datetime.now(timezone.utc).isoformat(),
            "runtime":runtime_report,"intended":intended_report,
            "database_names_match":runtime == args.expected_database,
            "schema_matches":runtime_report["schema_sha256"] == intended_report["schema_sha256"],
            "counts_match":runtime_report["table_counts"] == intended_report["table_counts"],
            "recovery_proven":False,"cutover_authorized":False}, sort_keys=True))
        return 0
    except (AuditError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"audit_complete":False,"error":str(error) if isinstance(error,AuditError) else "Read-only audit failed; inspect privately on host",
                          "recovery_proven":False,"cutover_authorized":False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
