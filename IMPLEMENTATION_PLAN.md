# Implementation plan

Read MEZON_SPEC.md and PROGRESS.md first each session. Reuse existing code. Each stage ends with focused tests, updated progress and a git commit. No model/reasoning change is assumed or requested.

1. **Evidence and durable specification** — audit all three local Excel files; record hashes, mappings, date/status ambiguity and limits of chat retrieval. Verify row counts/sums independently. Commit docs.
2. **First runnable slice (this request)** — dependency-free Worker + compact spreadsheet-like UI, D1 SQL migration, loopback demo adapter, Supabase identity verification, D1 authorization; synthetic seeded orders; immutable original amounts and ledger; agent request/approval and direct admin batch payments/notes; draft preview/Save/Cancel; current and period-end debt. Tests: identity, ownership, forbidden operations, pending requests, overpayment, rollback, duplicate approval, replay, stale versions, date cutoffs. Commit implementation.
3. **Excel import and R2 originals** — bounded XLSX decoder, all three versioned profiles, explicit year/ambiguous-date resolution and alias dictionaries, multi-file preview, conflicts, stable namespace policy, server commit/revalidation, provenance, R2/D1 recovery. Test reuploads/renames/overlapping files, cross-product IDs, legitimate repeat clients, malformed/oversized ZIPs, concurrent commits and rollback. Use actual sample bytes as local fixtures, do not commit personal raw data.
4. **Complete financial lifecycle** — approved-payment reversal/replacement, rejected requests, returns/refunds, effective-date validation, append-only audit, daily close and month close/reopen. Test exact-zero month gate, double corrections, settled-order returns, concurrent closing/posting and historic snapshots.
5. **Reporting and export** — server pagination/aggregates, client history, agent ranking, all-time history filters, CSV/XLSX export with formula escaping; current vs period-end debt reconciliation with ledger. Test permissions, timezones and inclusive end dates.
6. **Production readiness** — provision selected Cloudflare D1/R2 and Supabase Auth, rate limits, session policy, invitations/reset flow, upload retention, scheduled backups to R2 + verified restore, live D1/Workers integration tests and browser journeys. Release only after reconciliation and acceptance.

## Structure

`src/worker.js` API entry; `src/service.js` domain writes; `src/auth.js` identity; `src/validation.js` money/date validation; `migrations/` D1 schema; `public/` UI; `scripts/` local adapter/audit; `tests/` Node test runner; `docs/` audit evidence and setup; `wrangler.example.jsonc` production configuration template. No production dependencies needed for stage 1. Node 24 provides local SQLite and tests; production uses the D1 binding.

## Sources checked 2026-10-18

- [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch): prepared statements in batch roll back on statement failure.
- [Worker static assets binding](https://developers.cloudflare.com/workers/static-assets/binding/).
- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser) and [password authentication](https://supabase.com/docs/guides/auth/passwords).
- [Supabase changelog](https://supabase.com/changelog): checked Auth/TLS change and server adapter deprecation; no deprecated framework adapter used. Markdown endpoint was unavailable, HTML read instead.

These references support platform usage, not proof of live deployment. Stage 1 tests run local SQLite behind a D1-shaped adapter; actual D1 acceptance remains explicit.
