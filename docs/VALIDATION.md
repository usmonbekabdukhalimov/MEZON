# Validation record

2026-10-18, Node 24.21.0 on Windows. No production data or accounts used.

## Automated

Excel counts and monetary totals were independently cross-checked against raw XLSX worksheet XML using Python standard-library ZIP/XML parsing and Decimal arithmetic: all 3 files, 82 rows and total 232,801,884 matched the openpyxl audit.

21 tests passed using the production Worker handler and actual SQLite schema via a small D1-compatible local adapter. Covered money precision/bounds, valid dates and Asia/Tashkent midnight, authentication/disabled user denial, agent row ownership, prohibited payment writes, pending request balance invariance, request approval, direct admin payments, multi-row saves, full rollback on overpayment/stale row, idempotent replay, competing saves/approvals, immutable original/ledger/payment/audit, source key uniqueness with legitimate repeat clients, historical vs current debt, drafts and Supabase verifier responses.

`node scripts/check.mjs` passed all JavaScript syntax checks. Supabase responses in unit tests are mocked; no claim of live identity verification. Local competing Promise tests prove the tested adapter behavior, not Cloudflare concurrency certification.

## Browser and HTTP

- Local server returned HTTP 200 for page and `/api/health`.
- Admin loaded four synthetic orders; Agent saw only its three assigned orders.
- Entered 100 UZS on DEMO-1001 and a note on DEMO-1002. Row preview changed. A separate read-only SQLite check showed zero payments and empty saved note before Save.
- Cancel restored edits. Re-entered and saved; original DEMO-1001 sum remained 1,488,000, balance became 1,487,900 and second-row note persisted.
- Agent submitted a 50 UZS card request on DEMO-1001. Pending request appeared; balance stayed 1,487,900.
- Admin approved it. Balance became 1,487,850, pending count returned to zero, original sum stayed unchanged.
- Selected Bank before entering a 1 UZS payment on DEMO-1002; saved and confirmed the history event retained Bank. Added a regression test for this input order.
- Desktop screenshot reviewed: legible table, explicit demo label, separate debt cards, functional Save controls. Mobile layout rules exist; mobile browser interaction has not been validated.

Local socket checks initially failed inside the sandbox. The loopback-only preview was restarted with approved local networking and subsequently verified. This was not an approval rejection.

## Not yet verified

Cloudflare runtime/D1 integration, real Supabase sign-in, R2 file/backup paths and restoration, imported XLSX lifecycle, large datasets/pagination, expired-session recovery, production load and later-stage business workflows. See IMPLEMENTATION_PLAN.md.
