-- Run with the approved production read-only identity. No user rows or emails
-- are returned. Historical duplicate_role_slots=0 is not fresh evidence.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT current_setting('server_version') AS postgres_version;
SELECT version, success, encode(checksum,'hex') AS checksum
FROM _sqlx_migrations ORDER BY version;

-- to_jsonb permits this check before migration 42 adds removed_at.
SELECT count(*) AS duplicate_role_slots FROM (
    SELECT ps.plant_id,ps.role FROM plant_staff ps
    WHERE to_jsonb(ps)->>'removed_at' IS NULL
      AND ps.role IN ('dispatcher','operator','supervisor','accountant',
                      'quality_engineer','fleet_manager','store_manager')
    GROUP BY ps.plant_id,ps.role HAVING count(*)>1
) conflicts;
SELECT count(*) AS assigned_slots FROM plant_staff ps
WHERE to_jsonb(ps)->>'removed_at' IS NULL
  AND ps.role IN ('dispatcher','operator','supervisor','accountant',
                  'quality_engineer','fleet_manager','store_manager');
SELECT count(*) AS normalized_email_conflicts FROM (
    SELECT lower(btrim(email)) FROM users
    WHERE email IS NOT NULL AND btrim(email)<>''
    GROUP BY lower(btrim(email)) HAVING count(*)>1
) conflicts;
SELECT count(*) AS mismatched_staff_identities FROM plant_staff ps
JOIN users u ON u.id=ps.user_id
WHERE to_jsonb(ps)->>'removed_at' IS NULL
  AND ps.role IN ('dispatcher','operator','supervisor','accountant',
                  'quality_engineer','fleet_manager','store_manager')
  AND (u.role<>ps.role OR u.email IS NULL OR btrim(u.email)='');
SELECT count(*) AS duplicate_reserved_identities FROM (
    SELECT ps.user_id FROM plant_staff ps
    WHERE to_jsonb(ps)->>'removed_at' IS NULL
      AND ps.role IN ('dispatcher','operator','supervisor','accountant',
                      'quality_engineer','fleet_manager','store_manager')
    GROUP BY ps.user_id HAVING count(*)>1
) conflicts;
SELECT max(version) AS applied_migration_max,
       count(*) FILTER(WHERE NOT success) AS failed_migrations
FROM _sqlx_migrations;
ROLLBACK;
