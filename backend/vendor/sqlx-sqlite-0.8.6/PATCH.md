# Security compatibility patch

Source: the unchanged sqlx-sqlite 0.8.6 crates.io archive, retaining both upstream licenses.
The only upstream changes are the libsqlite3-sys requirement in Cargo.toml and
Cargo.toml.orig: 0.30.1 -> 0.39.1. This resolves RUSTSEC-2026-0459
(CVE-2026-119375) with bundled SQLite 3.54.1.

SQLx 0.8.6 restricts libsqlite3-sys to 0.30.x; released SQLx 0.9.0 also
excludes the fixed 0.39.x series. The local crates.io patch avoids a PostgreSQL
API migration or an advisory exception. The application still disables SQLx's
default features and does not select SQLite or MySQL. Cargo's full lockfile
resolution nevertheless includes the optional drivers.

Remove this patch when a compatible upstream SQLx release accepts a fixed
libsqlite3-sys. Do not add a RustSec ignore or change the audit assessor.

Upstream archive SHA-256: `c2d12fe70b2c1b4401038055f90f151b78208de1f9f89a7dbfd41587a10c3eea`.
