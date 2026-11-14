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
| `tests/` | `t_*.sql` scripts that print `PASS` / `FAIL` | app track (and data engineer for gold) |

Run order and how to run a file: `FINAL PLAN/04_Your_Runbook.md` RB-02. No client row data is ever stored in this repository.

## APP-0 spike scripts (`dev/`)

| File | Spike | Run when |
|---|---|---|
| `spike_s2_setup.sql` | S2: creates the empty `dev.spike` table that `sqlPing` writes to and rolls back | before the `sqlPing` test |
| `spike_s3_rule_reader.sql` | S3: proves a read-only user can run draft SQL; prints `PASS` / `FAIL` per step | once, then paste the Messages tab to Claude |
| `probe_engine.sql` | diagnostic: which engine the editor is connected to and which `CREATE TABLE` forms it accepts | only if a spike script fails with Msg 24584 |
