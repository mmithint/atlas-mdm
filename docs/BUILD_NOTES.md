# Build notes: what `atlas-mdm` looks like and how it is wired

Written in APP-0 on 13 Nov 2026 from reading the repository, updated the same day after the functions pack and again in APP-1 and APP-2 (14 Nov). Update it when something here changes. The plan lives in the project folder `OxyProject -Info` (`FINAL PLAN/`); this file only records facts about the code.

## 1. Tool versions seen on the build laptop

| Tool | Version | Note |
|---|---|---|
| Node.js | 22.14.0 | Rayfin needs 20 or later |
| npm | 11.21.1 | `DEPLOY.md`: npm 10 fails with "edgesOut"; npm 11 works |
| Rayfin CLI (`@microsoft/rayfin-cli`) | 1.36.2 (built 2 Oct 2026) | preview; commands change between versions |
| Rayfin guide (`@microsoft/rayfin-guide`) | 1.36.2 | the version-locked docs, read from `node_modules/@microsoft/rayfin-guide/assets/docs/` |
| Azure Functions Core Tools (`func`) | 4.16.1 (installed 13 Nov with `npm install -g azure-functions-core-tools@4`) | needed by `npx rayfin dev functions apply`, the only way to generate function types. It lands in `%APPDATA%\npm`, which was not on the User PATH, so add it there and open a new terminal |
| Template | `universal-app` (see `package.json` `template`) | applied packs are in `package.json` `rayfinPacks`: `data-modeling`, `functions` |

## 2. Layout

```text
atlas-mdm/
├─ package.json            npm workspaces root (packages/*); build and typecheck now build functions first
├─ rayfin/
│  ├─ rayfin.yml           services and the connector (section 3)
│  └─ connectors/atlas_sql_db/   one entity file (FieldCatalog, hand-written), schema.ts, metadata.json
├─ packages/
│  ├─ frontend/            React 19 + Vite 8 + Tailwind 4 + Vitest (@rayfin-app/frontend)
│  ├─ functions/           Rayfin functions (@rayfin-app/functions); section 5
│  ├─ data/                template's decorated Item entity; the Rayfin data service is off (D-01)
│  └─ shared/              browser-safe shared types (only the template's Item today)
├─ db/                     SQL for the ATLAS database; see db/README.md
├─ docs/                   this file
├─ scripts/                template's pack scaffolder (`npm run pack:add -- <pack>`), `validate-functions.mjs`, tests
├─ .agents/skills/         Rayfin skills; `AGENTS.md` says which to read first
├─ DEPLOY.md               run/deploy notes from 11 Nov
└─ extra/, test.json       untracked scratch files from connector discovery; not part of the app
```

## 3. `rayfin/rayfin.yml`

- `services.auth`: Fabric sign-in on (`externalEntraExchange: true`), password sign-in off. `allowedRedirectUris` lists the two localhost origins and the deployed URL.
- `services.data`: off. `services.storage`: off.
- `services.functions`: **on** since the pack (`path: packages/functions`, `auth.type: application`).
- `services.staticHosting`: on, `assetAccess: protected`, build command `npm run build:fabric`.
- `connectors`: one entry, `atlas_sql_db`, type `fabric-sqldatabase`, `auth.type: application`, operations **read only** since APP-2 (decision D-02; the Notes test page and the `TestNote` entity were removed with it).

## 4. Read path (functions for views, the connector for plain tables; decision D-17)

The deployed connector refuses every view (spike S7 and the table-versus-view probe, 14-15 Nov), so:

1. **Composed reads go through functions.** `packages/functions/src/equipment.ts` holds `runEquipmentSearch` and `runEquipmentDetail`; `function_app.ts` registers them as `searchEquipment` and `getEquipmentDetail` (inline handlers, plain text and number parameters). Each checks the caller, checks the input, runs ONE procedure (`app.usp_equipment_search`, `app.usp_equipment_detail`) and returns typed rows plus `timing`. **A failure comes back as text in the answer (`error`), it is not thrown**: on the deployed app the platform showed the browser only "InternalError: An internal execution error occured" for a function that failed, hiding the message. `unwrapRead` in `equipment-api.ts` turns `error` back into an exception. The frontend calls them as `getRayfinClient().functions.<name>.invoke(...)` in `features/equipment/equipment-api.ts`; the row types are the functions' own output types (`AppFunctionsSchema` in `types.ts`).
2. **Plain tables go through the connector.** `rayfin/connectors/atlas_sql_db/` has one hand-written entity, `FieldCatalog` (a table with a real key), plus `schema.ts` (`operations: ['read']`) and `metadata.json`. `rayfin connector add` writes only `metadata.json` and a placeholder, and `connector remove` / `add` would delete or overwrite the entity files, so do not run them. One refused entity fails the whole apply, so **never add an entity whose source is a view**.
3. `packages/frontend/src/lib/connectors.ts` is **hand-maintained**: the connector, its operations and the entity's fields by name (the decorated classes live outside the frontend package). `src/lib/connectors.spec.ts` compares it with the entity file and checks the read-only, no-view, key and length rules.
4. `packages/frontend/src/lib/rayfin-client.ts` builds `ConnectorsRayfinClient<UniversalAppSchema, AppFunctionsSchema, AppConnectorsSchema>`. **The functions pack overwrote this file** with the plain `RayfinClient` (it picks that variant because `connectors` is not in `rayfinPacks`; the connector was added by hand), which dropped the connector. It was restored to the template's connectors-plus-functions shape (`.agents/skills/connectors/kit/rayfin-client.with-functions.ts`). If a pack is applied again, check this file afterwards.
5. `rayfin/connectors/atlas_sql_db/metadata.json` has `schemas: []` and is not used. `rayfin connector inspect` lists tables and views live and needs no metadata, but listing a view proves nothing about whether the connector can attach it. Connectors do not run under `rayfin dev`: reads are tested on the deployed app.
6. **Latency gate:** the S7 card in `features/spikes/` times the read functions (first call apart from warm calls, browser time beside the function's own `timing.totalMs`). The rule is in `FINAL PLAN/03` APP-2.

## 5. Write path (functions)

- `packages/functions/src/function_app.ts` registers the functions. Rayfin's type generation reads each handler **inline** (an arrow function written inside `udf.func`), so handlers stay in this file and delegate to modules.
- Modules: `config.ts` (SQL server and database identifiers, no secrets), `identity.ts` (decode the caller's token claims), `sql.ts` (open a connection with `mssql` and the app identity's token, describe errors without leaking the token), `spikes.ts` (the APP-0 spikes), `equipment.ts` (`searchEquipment` and `getEquipmentDetail`, read path C).
- `packages/functions/src/types.ts` is **generated** by `npx rayfin dev functions apply`; never edit it. `scripts/validate-functions.mjs` fails the build if a registered function is missing from it.
- The root `typecheck`, `build` and `build:fabric` scripts build `shared` and `functions` before the frontend, so the frontend can import `AppFunctionsSchema` from `@rayfin-app/functions/types`.
- The frontend calls a function with `(await getRayfinClient()).functions.<name>.invoke()`.
- Spikes: `whoAmI` (S1), `sqlPing` (S2) and `storageProbe` (S4, OneLake write test) are registered. All three and the `#/spikes` page are removed in APP-10.
- `getMyProfile` (APP-2, `profile.ts`): token user id (`identity.ts` `callerId`, a GUID after `/users/`) → `app.usp_identity_resolve` → `app.usp_principal_profile` → one folded answer (status, roles, groups, flags, approval scopes). It only shapes the screen; procedures re-check every action.
- Function unit tests: `packages/functions/src/*.spec.ts`, run by `npm test` (vitest, no database; `sql.js` is mocked). The specs are excluded from `tsc` so they are never deployed.
- `types.ts`: the entries for `getMyProfile` and `storageProbe` were first written by hand in the generator's style (the generator needs `npx rayfin dev`, which is the user's step). `scripts/validate-functions.mjs` compares each entry with the handler's real type but does not print the expected text when they differ; to see it, copy the script and print `serialized.output`. Union members come out in the checker's order (not the written order), and `boolean | null` is `null | false | true`.

## 6. Frontend shell

`main.tsx` → `Root.tsx` (theme, error boundary, auth provider, `AuthGate`) → `App.tsx` → `ProfileProvider` → `AppShell` (APP-2). `src/app/`: `routes.ts` (every screen S-1 to S-13 and the spike page, with the phase that builds it), `router.ts` (hash addresses: parse, link, navigate), `profile.context.ts` / `profile.provider.tsx` (the `getMyProfile` answer, loaded once), `app-shell.component.tsx` (rail, header, notices), `nav.component.tsx` (role-aware menu), `screens.tsx` (route to screen; unbuilt screens show `placeholder.component.tsx`). `hooks/use-hash-route.ts` reads the address bar hash; `hooks/use-load.ts` is the loading/error/ready helper. Built screens: `features/equipment/` (S-4 search, S-5 detail) and `features/spikes/`. Styling: tokens in `global.css` (dark slate rail, steel-blue primary, amber for attention, `id-plate` utility for identifiers); shared class strings in `components/ui.ts`; join them with `clsx`, not `cn` (tailwind-merge mixes up the text-size tokens and text colours). Local `npx rayfin dev` signs in automatically through `@microsoft/rayfin-local-dev`.

## 7. Test baseline

`npm test` on 13 Nov before any APP-0 frontend change: 45 passed, **5 failed**, all from template tests that still expect the template's welcome page: `App.spec.tsx` renders `App` without an auth provider (`useAuth must be used within an AuthProvider`) and three tests in `Root.spec.tsx` look for the heading "Your app is taking shape". They fail since the Notes page replaced the welcome page (commit "added notes ui"), not because of the functions pack. They are to be replaced when the app shell lands in APP-2. New APP-0 tests (`use-hash-route.spec.ts`, `spikes.component.spec.tsx`) pass.

After type generation (14 Nov): `npm run typecheck`, `npm run lint`, `npm run build` and `npm run validate:functions` all pass; `npm test` gave 58 passed, 5 failed (the same 5).

**APP-2 (14 Nov):** the 5 stale tests are replaced (`App.spec.tsx` renders the shell, `Root.spec.tsx` recognises it by its menu). `npm test` now runs the frontend suite (187 tests, 19 files) and the functions suite (24 tests, 2 files); typecheck, build and lint are clean.

## 8. Known drift between notes and code

- `DEPLOY.md` still names the connector `atlassqldb`, and describes the Comment box and `dbo.TestNote` that APP-2 removed; the real connector name is `atlas_sql_db` (`rayfin.yml`).
- `DEPLOY.md` lists a deploy blocker from 11 Nov (403 while saving project settings for a guest account) that the tenant settings were meant to fix; the first full deploy in APP-0 is the proof.
- The plan said a function had been deployed and tested before 12 Nov; the repository had none until the pack was applied on 13 Nov.

## 9. Added in APP-0

| What | Where |
|---|---|
| `db/` folders and README | `db/README.md` |
| Spike S2 setup (empty `dev.spike` table) | `db/dev/spike_s2_setup.sql` |
| Spike S3 (can a read-only user run draft SQL?) Result: no, Fabric refuses `CREATE USER` forms that can be impersonated; fallback adopted in APP-5 | `db/dev/spike_s3_rule_reader.sql` |
| Spike S1 `whoAmI`, spike S2 `sqlPing`, SQL helpers | `packages/functions/src/` |
| Spike page and hash route | `packages/frontend/src/features/spikes/`, `packages/frontend/src/hooks/use-hash-route.ts`, `packages/frontend/src/App.tsx` |
| Browser-session check for S1 (the server token has no e-mail; this shows what the browser knows and whether its id is the id in `sub`) | `packages/frontend/src/features/spikes/browser-identity.ts` |

## 10. Added in APP-1 (14 Nov)

All SQL; no function or frontend code changed. File list and conventions: `db/README.md`.

| What | Where |
|---|---|
| 27 `app` tables, the run-id sequence | `db/migrations/0001`–`0007` (columns = `09_Data_Dictionary.md`, checked by `tools/schema_check.py`) |
| Security, routing and catalogue seeds | `db/seed/0101`–`0107` (0101–0105 generated by `tools/gen_ref46_seed.py` from the REF-46 extract) |
| Identity mapping (token user id → e-mail) | `app.principal_identity`, `app.usp_identity_resolve` (`01` §6.8). Functions get no change until APP-3 |
| Routing logic | `app.fn_group_for_role` (one place), `app.usp_route_resolve`, `app.vw_route_check` |
| Synthetic gold stub, merge stub | `db/dev/gold_stub.sql`, `merge_stub.sql`, `drop_stub.sql` |
| Paste-ready bundles | `db/dist/*.sql`, built by `tools/bundle_sql.py` (each file in its own `EXEC` batch; no `GO`) |

Decisions made while building: the column `trigger` of `app.business_rule_run` is `run_trigger` (TRIGGER is a reserved word; `09` §6.4); the types of three gold views are now stated in `01` §6.1; rule drafts get no read-only user (S3), so APP-5 guards the SQL text.
| Functions schema wired back into the client | `packages/frontend/src/lib/rayfin-client.ts` |
| Git-ignore for local seeds and secrets | `.gitignore` |

## 11. Added in APP-2 (14 Nov; read path C added 15 Nov; not yet run in Fabric)

| What | Where |
|---|---|
| Views for the search and detail screens | `db/views/vw_field_ownership.sql`, `db/views/vw_equipment_search.sql` |
| Their tests, and the paste-ready bundle | `db/tests/t_field_ownership.sql`, `db/tests/t_equipment_search.sql`; `db/dist/app2_1_views_tests.sql` (stage list in `tools/bundle_sql.py`; `app1_3` is now an explicit list so later views cannot slip into it) |
| One read-only connector entity (the five view entities were removed 15 Nov: the connector refuses views) | `rayfin/connectors/atlas_sql_db/` (`FieldCatalog`), `schema.ts`, `packages/frontend/src/lib/connectors.ts`, guard `connectors.spec.ts` (also fails if an entity names a view) |
| Read procedures and their test (read path C, D-17) | `db/procs/usp_equipment_search.sql`, `db/procs/usp_equipment_detail.sql`, `db/tests/t_equipment_read.sql`; bundle `db/dist/app2_2_read_procs_tests.sql` |
| Read functions | `packages/functions/src/equipment.ts` (`searchEquipment`, `getEquipmentDetail`; tests `equipment.spec.ts`), registered in `function_app.ts`, types in `types.ts`; frontend calls in `features/equipment/equipment-api.ts` (`equipment-api.spec.ts`) |
| Connector narrowed to read | `rayfin/rayfin.yml`, `schema.ts`, `connectors.ts` |
| Functions | `getMyProfile` (`packages/functions/src/profile.ts`, `identity.ts` `callerId`), `storageProbe` (`storage.ts`, config in `config.ts`) |
| App shell and screens | `packages/frontend/src/app/`, `features/equipment/`, `hooks/use-load.ts`, `lib/format.ts`, `components/states.tsx`, `components/ui.ts` |
| Spike cards | `features/spikes/spikes.component.tsx` (S7 latency gate in `s7-paging.ts`, S4 OneLake test) |
| Tests | frontend 185 tests, functions 61 tests (`npm test`) |

Decisions made while building (details in `FINAL PLAN/08` decision log, 14 Nov): `app.vw_equipment_search` had not been built in APP-1; Rayfin storage is not enabled in Fabric, so S4 became a OneLake probe; entity files are hand-written; the Notes page and `TestNote` entity were removed.

Behaviour worth knowing: search has two modes, and both are one function call (`searchEquipment`). With a text and no chosen sort (`MATCH`) the procedure returns the closest matches first (equal, then starts with, then contains), capped at 200, 500 and 500 rows per group, and the screen pages through that list in memory; with a chosen sort, or no text (`SORTED`), it returns one page per call, ordered by the chosen column with `equipment_id` as the last key, and the "cursor" is the row offset of the next page (the offsets already seen are kept so "Previous" works). The column being searched is always shown. A blank value is shown as a dash, never as zero. Dates arrive from the functions as ISO text.

## 12. Added in APP-4 (17 Nov; not yet run in Fabric)

The approval screens and the request dialog, on read path C (D-17): composed reads go browser -> function -> read procedure -> view; the connector still reads only `app.field_catalog`.

| What | Where |
|---|---|
| Shared runner for every function that acts for a person (identity from the verified token, one connection, failures returned as data, the envelope, the input helpers). Moved out of `requests.ts` unchanged | `packages/functions/src/runner.ts` |
| Five read functions: `getRequestQueue`, `getRequestDetail`, `getEquipmentRequests`, `getRequestFormOptions`, `getMyNotifications` (18 functions in all). Registered inline in `function_app.ts`, each with `await trustedAccessToken(ctx)`; `types.ts` entries generated from the validator's serializer | `packages/functions/src/request-reads.ts` (+ `request-reads.spec.ts`) |
| What a person may do with a request (`can_decide`, `can_approve`, `can_resubmit`, `can_cancel`, who a return goes to, each with a reason): one SQL function used by the queue and the detail procedure | `db/procs/fn_request_actions.sql` |
| Read procedures: `usp_request_queue` (one tab, the six counts, filters, paging, filter choices), `usp_request_detail` (eight result sets since 18 Nov: set 8 is who a Return may go to), `usp_notification_list`, `usp_request_form_options`, `usp_equipment_requests`. Each takes an optional `@only_set` (a testing aid: one numbered result set, because `INSERT ... EXEC` cannot capture sets of different shapes) | `db/procs/` |
| Test (13 checks, rolled back) and bundles | `db/tests/t_request_reads.sql`; `db/dist/app4_1_read_objects.sql`, `app4_2_request_reads_test.sql` |
| Client approval rules of 18 Nov (admin decides any stage; one person may approve both stages; Return to a picked person; orphaned returns; withdraw by submitter or admin). Contract: FINAL PLAN `01` section 3 | `db/procs/fn_stage_eligibility.sql`, `fn_return_candidates.sql`, `fn_return_rights.sql`, `usp_request_decide.sql`; test `db/tests/t_request_approval_rules.sql`; bundles `app4_0_approval_rules`, `app4_3_approval_rules_test`; the picker in `decision-panel.component.tsx` |
| Helper that makes test requests as you on synthetic heaters (you type your e-mail in the editor, never in the file) | `db/dev/app4_make_test_requests.sql` |
| Screens: S-2 Approvals, S-3 Request detail with the decision panel, the request dialog and "Requests on this heater" on S-5, the notification bell | `packages/frontend/src/features/approvals/`, `features/equipment/` (`request-dialog*`, `equipment-requests*`, `change-request-api.ts`), `features/notifications/` |
| A dialog without a library, and the helper that turns a not-ok function answer into an exception with the function's own words | `components/modal.component.tsx`, `lib/act-answer.ts` |
| Route table knows which phases are built (the menu dims the rest) | `app/routes.ts` (`BUILT_PHASES`, `isBuilt`), `app/nav.component.tsx` |
| Tests | frontend 429, functions 244 (`npm test`) |

Behaviour worth knowing: the queue's tab, filters and page size live in the address (`#/approvals?tab=ACCOUNTABLE&pc=...`), the row offset does not; the age filter applies to open requests only (the server ignores it on Approved and Rejected); a person who approved the first stage can still reject or return at the second but not approve (`can_decide` versus `can_approve`); Return has no recipient picker because the procedure accepts exactly one recipient; the bell shows an unread count that cannot be cleared until APP-8; after a final approval the screens say the golden-record update is pending while the merge is still the stub. Specs that mock a rejecting function must use a block body in `beforeEach` (`mockReset()` returns the mock, which vitest then calls as teardown).

## 13. Added for spike S5, OxyGPT reachability (18 Nov; the first three modes ran in Fabric on 18 Nov and failed on network reach; the `agent` mode, 19 Nov, has not been run in Fabric)

| What | Where |
|---|---|
| Function `oxygptProbe` (19 functions in all): four modes, `dns` (does the host resolve from Fabric, private or public), `models` (TLS, key, model IDs) `text` (a free-text question, empty = "pong") and `agent` (the client's saved-chat flow, next rows). Admin only (verified token, registered person, `canManageAdmin`); failures come back as a `category` plus words, never thrown; the key, the question and the answer are not logged | `packages/functions/src/oxygpt.ts` (+ `oxygpt.spec.ts`), registered in `function_app.ts`, entry in `types.ts` |
| Settings: base URL `https://ai-dev.oxy.com`, timeouts and length limits, and a fallback for the agent's model ID (empty). The key and the agent's ID are the secrets `OXY_GPT_API_KEY` and `OXYGPT_AGENT_MODEL_ID` (the names the team gave them in Fabric), read by name: `ctx.Secrets` is typed only for names `rayfin secret set` has written into `secrets.generated.ts` (never hand-edit it; it lists none yet), and it reads the delivered secret bag first and the environment second | `packages/functions/src/config.ts` (`OXYGPT`), names in `oxygpt.ts` (`SECRET_API_KEY`, `SECRET_MODEL_ID`) |
| Spikes card with three buttons and a question box | `packages/frontend/src/features/spikes/spikes.component.tsx` (`OxygptCard`) |
| `agent` mode (19 Nov): a step-for-step port of the client's reference script `TeamsFolder/oxy_agent.py`. Pieces: `discoverAgent` (model list plus the key owner's settings, giving the tool, skill, filter and feature settings sent with the turn), `createChat`, `startTurn` (`stream: true`, `chat_id`, `session_id`, returns task ids), `turnFinished` (one poll), `collectTurn` (pending tool, error, `done`, filter-changed text), `deleteChat`, and `runAgentTurn`, which runs them in one call inside a time budget (220 s in all; the wait ends at 205 s, 15 s kept for the delete). The probe supplies the transport (key, no redirects, time limit, categories), so the module reads no secret and logs nothing. Result: `agent.steps`, `agent.config` (counts), `agent.toolCalls` (names), `agent.chatDeleted`, `agent.chatId`; new categories `AGENT_NOT_LISTED`, `AGENT_NO_TASK`, `AGENT_WAITING`, `AGENT_FAILED` | `packages/functions/src/oxygpt-agent.ts` (+ `oxygpt-agent.spec.ts`), wired in `oxygpt.ts`, limits in `config.ts` (`OXYGPT.agent*`), button "Ask the agent" in `spikes.component.tsx` |
| A pretend OxyGPT built only from what the script reads and writes (11 scenarios: working, tool waiting for approval, error, unfinished, filter-changed text, agent not listed, no task, no settings route, sign-in page, delete fails, never finishes). Used by the unit tests, by `node tools/oxygpt_fake.mjs probe` (our compiled probe over real local HTTP) and by `serve`, so the client's own script can be run against it. The client's script and the port were compared on all 11 and agree, except that the port deletes the chat after a failure | `tools/oxygpt_fake.mjs` |
| Tests | frontend 437, functions 357 (`npm test`) |

Behaviour worth knowing: the `types.ts` entry for a function with a union-typed output must list the union members in TypeScript's own internal order, which is not the source order; `node scripts/validate-functions.mjs` fails with "stale" until it matches, and `npx rayfin dev functions apply` rewrites it correctly. The unit tests mock `fetch` and the DNS lookup, so nothing here proves the cloud can reach the service: that is the point of running the spike. Removed in APP-10 with the other spikes. In `agent` mode the chat is deleted after every turn except while a tool waits for a person to approve it (the client's script keeps the chat after any failure; an unattended function must not leave chats in someone's account), and a failure names its step. `oxygpt-agent.ts` imports only types from `oxygpt.ts`, so the two files cannot import each other in a loop (a test checks it). The pretend service encodes how the script is written, not how OxyGPT behaves: passing against it proves the port matches the script, not that the real service answers the same way. On 19 Nov the `oxygptProbe` entry of `types.ts` was edited by hand to the validator's expected text (the generator is a Fabric command); `functions apply` may rewrite it.


## 14. UI development without a server: `npm run dev:mock` (19 Nov)

Why: under `npm run dev` (`rayfin dev`) the functions run on the developer's own Microsoft account, and Fabric SQL refuses it ("Verify the user has the Read item permission"), so every SQL-backed screen was empty. Connectors do not run locally either (section 4). The deployed app works because there the functions run as the app identity.

What: `npm run dev:mock` starts plain Vite in mode `mock` (no function host, no `rayfin login`, no network). The screens run unchanged; `client.functions.<name>.invoke(...)` and the field-catalogue read are answered by `packages/frontend/src/dev-mock/`:
- `mock-functions.ts`: one handler per function, typed against `AppFunctionsSchema` (a changed function answer breaks the file at compile time). 60 invented heaters, 22 invented requests spread over every Approvals tab, notifications, the field catalogue. State is in memory: approve, return, reject, withdraw and "create request" move rows between tabs until the page reloads (`resetMock()` does the same in tests).
- `mock-client.ts`: the client stand-in, the fake sign-in (`dev.user@example.test`, every permission) and an orange "MOCK DATA" banner.
- `mock-functions.spec.ts`: the handlers' behaviour.

Rules: all data is invented (SYN- identifiers, example.test addresses); no client data. The only hooks are two `import.meta.env.DEV && import.meta.env.MODE === 'mock'` branches (`lib/rayfin-client.ts`, `main.tsx`), so a production build contains none of it (checked: no mock string in `packages/frontend/dist`). `scripts/validate-functions.mjs` skips the `dev-mock` folder because the stand-in client needs one cast; the typed handlers still catch a stale schema.

Not mocked: `whoAmI`, `sqlPing`, `storageProbe`, `oxygptProbe` (the spike screens) throw "not mocked". When a new function is added, add its handler to `mock-functions.ts` (the `Handlers` type makes that a one-line, type-checked change). It shows what the screens do, not whether the stored procedures are right: that is still tested on the deployed app (`npx rayfin up`).
