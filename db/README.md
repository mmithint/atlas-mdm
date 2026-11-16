# db/

All SQL for the ATLAS database (`ATLAS_SQL_DB` in Fabric). Conventions (names, keys, types, migrations) are in `FINAL PLAN/01_Architecture_and_Contracts.md` §5 in the project folder `OxyProject -Info`; columns of every `app` table and view are in `FINAL PLAN/09_Data_Dictionary.md`. This file only says what each folder is for.

| Folder | Holds | Written by |
|---|---|---|
| `migrations/` | numbered, re-runnable table scripts (`0001_…`); never edited after they have run | app track |
| `procs/` | `app.usp_*` stored procedures, each `CREATE OR ALTER` | app track |
| `views/` | `app.vw_*` views, each `CREATE OR ALTER` | app track |
| `seed/` | configuration rows (roles, groups, routes, field catalogue, settings, rules) | app track |
| `seed/local/` | people's e-mails and other local-only rows. **Git-ignored; never committed** | you |
| `dev/` | spike scripts and the synthetic gold stub (temporary, schema `dev`) | app track |
| `gold/` | gold tables, views and the merge procedure | data engineer |
| `tests/` | `t_*.sql` scripts that print `OK` / `FAIL` lines and a final `RESULT:` line | app track (and data engineer for gold) |
| `dist/` | **generated** bundles of the files above, one paste per stage (`app1_1_migrations.sql` …). Never edit; rebuild with `python tools/bundle_sql.py` | `tools/bundle_sql.py` |

Run order and how to run a file: `FINAL PLAN/04_Your_Runbook.md` RB-02. No client row data is ever stored in this repository.

## Conventions every script follows

- One batch per file, **no `GO`** (the Fabric SQL editor's support for it is not confirmed). `CREATE OR ALTER` procedure, function and view files hold that one statement only; anything conditional uses `EXEC (N'…')`.
- Fabric SQL engine rules found in APP-1 (filtered-index predicates, `PRINT` takes plain values only): `FINAL PLAN/01` §5.
- Starts with the engine guard (stops in the SQL analytics endpoint or a warehouse) and prints `OK` / `FAIL` / `INFO` lines; tests end with `<name> RESULT: …`.
- Tables: one column per line inside `CREATE TABLE app.<name> ( … );`, so `tools/schema_check.py` can compare them with `09_Data_Dictionary.md`.
- Seeds are re-runnable (`INSERT … WHERE NOT EXISTS`, never an overwrite of something an admin changed). People, e-mails and user ids live **only** in `seed/local/`.
- Test data is obviously fake (`SYN-…` heaters, `@example.test` people) and tests that insert roll back.

## Tools (`tools/`, offline, standard library only)

| Tool | What it does |
|---|---|
| `schema_check.py` | compares `db/migrations` with the data dictionary (name, type, null, identity, order) and writes `tests/t_app_schema.sql` |
| `gen_ref46_seed.py` | reads the REF-46 extract and writes `seed/0101`–`0105` (never reads or writes e-mails) |
| `bundle_sql.py` | builds `dist/*.sql`; `--check` fails when they are out of date |

## APP-1 files

| Kind | Files |
|---|---|
| Migrations | `0001_schemas` (app, dev), `0002_settings_catalog`, `0003_security` (incl. `app.principal_identity`), `0004_requests`, `0005_evidence`, `0006_rules` (incl. the run-id sequence), `0007_notifications` |
| Seeds | `0101_roles`, `0102_groups`, `0103_routes`, `0104_assignments`, `0105_role_alias` (generated from REF-46); `0106_field_catalog_v1`, `0107_app_settings` |
| Local seed | `seed/local/pov_members.sql` (git-ignored; you fill six values) |
| Procedures and function | `fn_group_for_role` (the one place that chooses a group), `usp_identity_resolve`, `usp_principal_profile`, `usp_route_resolve` |
| Views | `vw_route_check`, `vw_group_member_count` |
| Stub (temporary) | `dev/gold_stub.sql`, `dev/merge_stub.sql`, `dev/drop_stub.sql` (removes only objects marked `-- ATLAS-STUB`) |
| Tests | `t_app_schema` (generated), `t_security_seed`, `t_identity_resolve`, `t_route_resolve`, `t_gold_contract` |

## APP-2 files

| Kind | Files |
|---|---|
| Views | `vw_field_ownership` (owners per catalogue field, read by S-5 and later S-13), `vw_equipment_search` (the 26 gold columns plus three counters; reads `gold.vw_equipment_current` and `gold.vw_verification_score`, so it needs the gold stub or the real gold first) |
| Tests | `t_field_ownership` (21 checks, agrees with `usp_route_resolve`), `t_equipment_search` (9 checks; inserts three fake requests in a transaction and rolls them back) |
| Bundle | `dist/app2_1_views_tests.sql` (views, then tests) |
| Read procedures (read path C, D-17) | `usp_equipment_search` (searchable columns, closest-match order, row caps, offset paging; refusals 50011 to 50016), `usp_equipment_detail` (four result sets: heater, location, field values, field owners) |
| Test | `t_equipment_read` (12 checks; R8 changes four stub rows inside a transaction and rolls them back) |
| Bundle | `dist/app2_2_read_procs_tests.sql` (the two procedures, then the test; run after `app2_1`) |

## APP-0 spike scripts (`dev/`)

| File | Spike | Run when |
|---|---|---|
| `spike_s2_setup.sql` | S2: creates the empty `dev.spike` table that `sqlPing` writes to and rolls back | before the `sqlPing` test |
| `spike_s3_rule_reader.sql` | S3: proves a read-only user can run draft SQL; prints `PASS` / `FAIL` per step | once, then paste the Messages tab to Claude |
| `probe_engine.sql` | diagnostic: which engine the editor is connected to and which `CREATE TABLE` forms it accepts | only if a spike script fails with Msg 24584 |
| `probe_s7_views.sql`, `probe_s7_views_drop.sql` | S7 follow-up (15 Nov): a control table and four views in schema `dev` for `tools/probe_view_vs_table.ps1`, and their removal | B3c of `your_steps/APP-2.md`; the drop script when the result is recorded |
