# MEZON specification

Status: approved requirements from the user's 2026-10-18 request; first local implementation stage only.

## Production completion request (2026-10-18)

User now requests the complete version and deployment to Cloudflare + Supabase, pushed to GitHub with a continuation checkpoint for Claude. Each admin and agent needs an individual email/password account. A receipt or agent request can split one total across cash, card and bank (e.g. 50/50), preserving each allocation in history, correction and cashbox reports. Excel upload must be visible and operational. All previously deferred accounting/reporting/backup workflows are now in scope. CONTINUE_HERE.md records live setup decisions and progress.

## Evidence and scope

The referenced chat `6ad3ccff-aee0-83ed-bb2d-7ee2f5deb227` was read. The connector returned five recent exchanges, assistant reference placeholders, no older cursor and no attachments. No claims about Excel from that chat were accepted as facts. The current user request is the authoritative requirement set.

Original local files were located in `C:/Users/Usmonbek/Downloads/Telegram Desktop`. Their bytes, sheets, headers, all data rows, types, IDs, required fields and sums were inspected independently. See `docs/EXCEL_AUDIT.json` for hashes and reproducible results and `scripts/audit_excel.py` for the read-only audit. These are local copies with the requested names; identity with the inaccessible chat attachments cannot be proven.

| File | Sheet / range | Header row | Orders | Sum of Сумма |
|---|---|---:|---:|---:|
| лапша.xlsx | Sheet / A1:H17 | 1 | 16 | 9,379,200 |
| н.медов.xlsx | Sheet1 / A1:N26 | 2 | 24 | 34,799,690 |
| крембер.xlsx | Sheet / A1:H43 | 1 | 42 | 188,622,994 |

Total: 82 rows; 232,801,884 source currency units. All IDs unique within and across these samples. No formulas, missing ID/amount/agent/client fields, nonpositive amounts or fractional amounts found. Counts are data rows, excluding headers/title. No inference that future files have the same size, dates or uniqueness. Currency is not declared by the files; UZS with two decimal minor units is the initial configurable business assumption.

## Architecture and roles

- Cloudflare Workers serves UI and API. Cloudflare D1 stores business data. Cloudflare R2 stores immutable original Excel files and encrypted/access-controlled backups. Supabase is used for individual Auth accounts only; no business tables in Supabase.
- Exactly two business roles: `admin` (Admin/Buxgalter) and `agent`. D1 maps verified Supabase user ID to role, active status and agent ID. Neither request parameters nor editable Supabase user metadata authorize access.
- Every protected API validates identity and permissions server-side. Agent reads and requests are scoped to their own orders, including historical records. Admin manages imports, payments, corrections, references, closing, audit and exports.
- Initial local development uses a separate loopback-only demo adapter and synthetic records. Production Worker has no demo-token bypass. Real sign-in requires supplied Supabase URL/publishable key and provisioned account mappings.

## Import contracts

Multiple daily workbooks form one preview session. Upload original bytes first to a private R2 key with SHA-256, file size, uploader and time; record upload state in D1. Parse each sheet with size/row/uncompressed ZIP limits. No formulas/macros/external-link evaluation. Keep source row, raw values, mapping version and source file provenance.

Profiles verified from local files:

| Field | лапша | крембер | н.медов |
|---|---|---|---|
| source_order_id | A: ИД заказа | A: ИД заказа | B: № |
| business date | B: Дата доставки | B: Дата и время создания | D: Дата заявки (year required) |
| agent alias | C: Торговый представитель | C: Торговый представитель | M: Агент |
| client alias | E: Клиент | E: Клиент | F: Клиент |
| initial debt | F: Сумма | F: Сумма | I: Сумма |
| area | D: Рабочая зона | D: Рабочая зона | N: Город |
| price/status raw | G/H | G/H | J/K; C type; L state |

`н.медов` has merged A1:N1 title, empty column A, 14 columns, header row 2. D stores strings such as `17.10 08:37`, without year. E stores numeric `17.1`/`16.1` under `0.00`, not an Excel date; do not interpret it as an Excel serial or January. Keep it raw and block automatic shipment-date mapping until explicitly resolved. K contains HTML entities and a list of available actions (including return/new), so it is not a reliable single business status. Do not infer returns or payments from that field or price labels. L is empty in these samples.

Product family is selected in the mapping; none of the samples has a product/SKU column. Preserve differing date meanings (delivery vs creation vs application). Default dashboard order date follows the configured profile; display its meaning. All business cutoffs use Asia/Tashkent.

IDs remain text; reject lossy numeric IDs, missing keys or unsupported precision. Use server UUID internal order ID. Stable duplicate key is `(source_namespace, source_order_id)`, independent of filename, date and upload. Source namespace denotes the actual upstream ID domain, NOT arbitrary filenames/product selection. лапша and крембер appear structurally related, but shared ID-domain semantics must be confirmed before production mapping; conservative shared namespace prevents cross-product duplicate import. Source-ID reuse/reset requires an explicit verified namespace policy, never silent monthly reset.

Preview classifies new / unchanged duplicate / conflicting duplicate / invalid / unresolved mapping. Same source ID with changed amount/date/agent/client is a conflict, never an overwrite. Repeated customer or agent is valid and never a dedupe key. Resolve agent/client aliases explicitly; spelling similarity alone cannot merge identities. Preview does not create financial entries. Commit revalidates against current D1 state, has an idempotency key, uniqueness constraints and atomic order + initial ledger + audit persistence. Refresh preview after mapping edits. R2 and D1 are not a shared transaction: upload state and safe orphan cleanup/retry are required.

## Financial invariants

Excel `Сумма` is immutable initial full debt for EACH newly imported order. Store integer minor units, reject unsafe/negative/zero/over-precision values. Original amount stays visible forever.

Current debt = opening charge + corrections that increase debt - approved cash/card/bank payments - approved return credits. Pending/rejected payment requests never affect debt. Admin can post a payment without any request. No stored agent-held cash balance. No implicit payment based on an Excel status.

Append-only ledger carries order, kind, amount, actor, request/payment linkage, effective business date and recorded UTC timestamp. Approved correction is a reasoned reversal plus replacement linked to original event; never UPDATE/DELETE a posted amount. Prevent double reversals and over-return/overpayment; return versus refund rules need explicit design in that stage.

Admin can edit multiple table rows. Draft payment/notes calculations are browser state only until **Save Changes**. Cancel discards drafts. Save sends one validated batch and idempotency key. Optimistic versions reject stale rows; all changes, ledger and audit commit or roll back together. Retry after ambiguous network failure reuses the exact payload and key.

Agent submits a request for exactly one owned order, positive amount and method. States: pending → approved/rejected. Approval creates one payment atomically; replay cannot pay twice. Amount and order are immutable once submitted. Rejection records reason and reviewer. Agent sees all-time request/payment/order history.

## Reporting and closing

- Dashboard: today's orders and distinct clients, outstanding debt, pending requests; date, agent and product filters.
- Show separately: (1) today's outstanding debt for orders in selected order-date period; (2) historical debt of that same cohort as of the end of that period. Also label any portfolio-wide as-of report distinctly. Historical computation uses effective event cutoff, and excludes orders not yet effective.
- Events retain recorded timestamps so later corrections can support both a restated effective-date view and an as-known-at-the-time view. Closed snapshots are versioned, not silently overwritten. No backdating UI in stage 1.
- Month closing is a real financial control: every relevant order must have zero debt from legitimate posted events; unresolved pending requests/conflicts must be resolved. Closing must fail on nonzero debt. Never auto-zero, delete, write off or hide previous debt. New month starts at zero only after this verified close. Old order/ledger history remains readable. Reopening requires reason, authorization and audit.
- Daily close reconciles cash/card/bank payments and returns, reviewer and snapshot. It does not track money held by agents.
- Client history aggregates stable client IDs. Agent ranking has explicit metric and period (e.g. approved collections, sales); returns/corrections affect figures. Exports honor permissions/filters and neutralize spreadsheet formula injection.
- Audit covers imports, edits, approvals/rejections, reversals, closes/reopens, user role changes and exports. Append-only at application level. Scheduled D1 logical export to R2, original-file retention, checksums, manifests and tested restoration are required before production.

## Explicit exclusions

No inventory/stock, overdue-debt tracking, agent-held funds balance, extra business roles or silent model/reasoning changes.

## Acceptance boundaries

First minimal stage: runnable local UI, protected API contract, two-role isolation, order ledger, pending requests and approval, direct admin payments, draft table Save/Cancel, transaction rollback/idempotency/version tests, current vs end-date debt, schema and Cloudflare configuration template. Synthetic demo data is labelled. Real XLSX upload/commit, R2 persistence, corrections, returns, exports/ranking, closings and backup operations follow in small tested commits; UI must not imply they exist already.

Release blockers: confirm upstream namespace and date interpretation/year, choose real Supabase and Cloudflare resources, provision account/agent links, validate live auth and D1 behavior, complete subsequent stages and restore drill. The old chat's unavailable earlier content remains a context limitation, not a reason to invent requirements.
