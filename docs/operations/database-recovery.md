# TrackLab Database Backup And Recovery

TrackLab stores accounts, sessions, subscriptions, published mappings, custom
routes, bike profiles, studio riders, multiplayer state, race results, and
ghost laps in PostgreSQL. A deployment is not production-ready unless this
data can be restored independently of the running application.

## Initial Beta Targets

The product owner must approve final recovery objectives. Until then, use:

- Recovery point objective (RPO): no more than 24 hours of durable data loss.
- Recovery time objective (RTO): restore core service within 2 hours.
- Restore drill: at least monthly and before any destructive migration.

These are operational targets, not guarantees from the application. Confirm
the retention, point-in-time recovery, and regional durability included with
the selected Render PostgreSQL plan.

## Create A Verified Backup

Use a machine with PostgreSQL client tools compatible with the hosted server.
Keep credentials out of shell history where possible.

```bash
export BACKUP_FILE="tracklab-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" \
  --file="$BACKUP_FILE"

pg_restore --list "$BACKUP_FILE" > "$BACKUP_FILE.list"
shasum -a 256 "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
```

A backup is not verified merely because `pg_dump` exited successfully. Store
the dump, object list, checksum, source database identifier, server version,
commit SHA, and timestamp in access-controlled storage outside Render.

Do not place backups in the Git repository, a public object bucket, or a
developer's unencrypted Desktop folder.

## Restore Drill

Restore into an isolated database. Never test recovery over production.

```bash
createdb "$RESTORE_DATABASE_NAME"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$RESTORE_DATABASE_URL" \
  "$BACKUP_FILE"
```

Then verify the migration ledger and representative data:

```bash
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT version, name, applied_at
FROM tracklab.schema_migrations
ORDER BY version;

SELECT 'auth_users' AS relation, count(*) FROM tracklab.auth_users
UNION ALL
SELECT 'user_data', count(*) FROM tracklab.user_data
UNION ALL
SELECT 'public_track_mappings', count(*) FROM tracklab.public_track_mappings
UNION ALL
SELECT 'race_results', count(*) FROM tracklab.race_results
UNION ALL
SELECT 'ghost_laps', count(*) FROM tracklab.ghost_laps;
SQL
```

Start a non-public TrackLab instance with `DATABASE_URL` set to the restored
database and `TRACKLAB_REQUIRE_DATABASE=1`. Run:

```bash
TRACKLAB_SMOKE_URL=https://restore-test.example.com \
TRACKLAB_EXPECT_POSTGRES=1 \
npm run smoke:deployment
```

Also confirm a known account, published track mapping, saved bike profile,
race result, and ghost lap. Record row counts without exporting passwords,
session tokens, rider data, or other personal data into the release ticket.

## Production Recovery

1. Declare the incident and stop writes when continued operation can worsen it.
2. Record the last known-good timestamp and affected data classes.
3. Preserve current logs and take a forensic backup before changing production.
4. Select the restore point that satisfies the incident's integrity analysis.
5. Restore to an isolated database and complete the validation above.
6. Point a staging instance at the restored database and run smoke tests.
7. Rotate database credentials if compromise is possible.
8. Switch production only after the incident owner and database operator sign off.
9. Run the production smoke test and monitor errors, latency, and persistence.
10. Reconcile billing events, races, mappings, or profiles created after the restore point.

## Migration Integrity

TrackLab records migration version, name, and SHA-256 checksum in
`tracklab.schema_migrations`. Startup refuses to continue when an applied
migration no longer matches its checksum or the database is newer than the
server supports.

Rules:

- append new migrations; never reorder or rewrite applied migrations;
- validate every migration against a recent restored backup;
- use forward repair migrations for correctable production issues;
- use recovery when forward repair cannot preserve data integrity;
- do not bypass the advisory lock or migration transaction manually.

## Drill Record

For each drill, record:

| Field | Value |
| --- | --- |
| Backup timestamp | |
| Source environment | |
| Application commit | |
| Backup SHA-256 | |
| Restore start and finish | |
| Measured RPO and RTO | |
| Migration version | |
| Representative records verified | |
| Smoke result | |
| Operator and reviewer | |
| Follow-up actions | |

