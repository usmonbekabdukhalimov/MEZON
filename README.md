# MEZON

Mini ERP for Admin/Buxgalter and Agent. Workers backend, D1 financial ledger, R2 originals/backups, Supabase Auth. Read MEZON_SPEC.md and CONTINUE_HERE.md for requirements and release status.

Node 24+:

    npm ci
    npm test
    npm run check
    npm run build
    npm run dev

Local preview: http://127.0.0.1:8787 uses synthetic users and data only. Production never accepts demo tokens. The real sample test is opt-in via MEZON_SAMPLE_DIR; original workbooks are not in this public repository.

The admin edits cash/card/bank allocations and notes in the grid, then Save Changes commits all rows atomically. Agents submit order-specific requests. Originals and posted financial history stay immutable. Import is under Excel import. Accounts, clients, ranking, audit, closing and backups each have a sidebar screen.

See docs/RECOVERY.md for backup recovery. Cloud deployment, admin setup and GitHub sync status are tracked in PROGRESS.md. No credentials belong in source or GitHub issues.
