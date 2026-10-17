# MEZON continuation checkpoint

Read this file, PROGRESS.md and git status first. Do not ask for the chat again. No model/reasoning setting was changed.

## Authorization and resources

User requests complete MEZON, individual username/password accounts, split cash/card/bank receipts, Excel uploads, Cloudflare Workers/D1/R2 and Supabase Auth, GitHub upload. Public source is explicitly intentional (2026-10-18). Never commit secrets, original workbooks or customer data.

- GitHub: https://github.com/usmonbekabdukhalimov/MEZON (main, public). User created repository; source upload pending verification.
- Supabase: MEZON `uupdfhkolbborzqaiwpg`, Qalqon organization `mbhdxxmzmwibghumcjjm`, active Seoul region. Do not modify the separate Qalqon project.
- Managed Sites: `appgprj_6ad3df74e5ac8191997cfcd32c63c8a1`; reuse `.openai/hosting.json`, never create another Site. Private unpublished at this checkpoint. Expected URL https://mezon-erp.ousmaneabdukhalimov.chatgpt.site is not evidence of deployment.
- First admin username: admin001. User supplied password in conversation; never write it here or in source. Server secret key needed for provisioning. User asked to save key only to ignored `.local/supabase-secret.txt`; transfer to Sites runtime SUPABASE_SECRET_KEY without printing it.
- Agent accounts are created by admin after import reference agents exist. Synthetic internal Auth addresses enable username login without requiring real email; recovery is administrator-assisted.

## Implemented, pending cloud verification

Workers API: Supabase token validation plus D1 role/ownership checks, secure HttpOnly session cookies, origin checks, login throttling, individual account creation, one-time secret-protected initial admin setup. Split receipts/requests, immutable opening ledger, corrections via reversal/replacement, returns with refund allocations, date/agent/product reports, clients, ranking, audit, day/month closing and reasoned reopen. Original workbook R2 upload, parsed previews, explicit reference creation, fixed format mapping, source-key dedupe, atomic commit. Backup snapshot and checksum-verified restore to a new local database. UI screens for those workflows.

Month closure requires both present debt and period-end historical debt to be zero. Payment after month end does not falsify historical closure. No automatic reset. No inventory/overdue/agent-cash module.

Known work still required: cloud deployment and runtime validation, admin provisioning, scheduled backup configuration, GitHub source synchronization, full visual QA (browser policy blocked local tab observation), more auth/negative-import tests, review scalability limits (200 rows/import, 50 changes/save; report reads currently unpaginated). Do not call this production-ready until these are resolved.

## Tests and next steps

29 tests passed including actual three Excel samples (82 rows / 232,801,884 UZS), repeat import, split receipts, atomic rollback, corrections, returns, closing, backup restore. Syntax checks and Worker bundle pass. Real sample test runs only with MEZON_SAMPLE_DIR, so CI will skip it and use synthetic fixtures otherwise.

Run npm ci; npm test; npm run check; npm run build. Production build embeds UI assets in dist/server/index.js. Generated Drizzle migrations mirror migrations/ for Sites deployment. Applied migrations must never be edited. Read Sites skill before packaging/publishing. Source helper owns source push and archive; send credentials through hidden stdin only. Preserve private site audience (public GitHub approval does not authorize public financial data).

## Sample evidence

Original files: C:/Users/Usmonbek/Downloads/Telegram Desktop/{лапша.xlsx,н.медов.xlsx,крембер.xlsx}. docs/EXCEL_AUDIT.json is independently checked evidence. Missing н.медов year requires explicit import confirmation. Its numeric shipment date remains raw, not guessed. Scientific notation source IDs are expanded as decimal strings. Never upload actual files into the public repo or seed cloud with customer data during tests.
