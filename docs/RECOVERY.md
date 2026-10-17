# Recovery

Admins can create/download a database snapshot from Backup. It includes immutable ledger, payment allocations, audit, users (IDs/roles only, never passwords), import metadata and raw cell values. Treat downloads as confidential financial data. R2 originals/ objects are retained separately and must be retained alongside database backups.

Verify and restore to a NEW database path:

    node scripts/restore.mjs backup.json recovery.db

The tool refuses an existing destination, verifies SHA-256 and schema/table manifest, restores in one transaction, reinstates immutable triggers, checks foreign keys, integrity and nonnegative balances. Restore is tested locally. It never overwrites a live D1 database. Production disaster recovery requires a new D1 database, offline validated SQL export/import and a binding switch after reconciliation; stop writes, retain the old DB, compare order counts, original totals, balance totals and payment allocations before reopening. Supabase Auth accounts remain in the existing MEZON project; preserve its project and IDs.

Automatic backups: Worker scheduled handler and secret-protected POST /api/scheduled-backup are implemented. Set BACKUP_TOKEN as a runtime secret and configure the managed Sites schedule (pending deployment). Do not place tokens in schedule prompts or source. Missing schedule means automatic backups are not active. Snapshot retention is manual; no automatic deletion is enabled.
