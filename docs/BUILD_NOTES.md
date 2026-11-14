# Build notes: what `atlas-mdm` looks like and how it is wired

Written in APP-0 on 13 Nov 2026 from reading the repository, updated the same day after the functions pack. Update it when something here changes. The plan lives in the project folder `OxyProject -Info` (`FINAL PLAN/`); this file only records facts about the code.

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
│  └─ connectors/atlas_sql_db/   TestNote.ts (entity), schema.ts, metadata.json
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
- `connectors`: one entry, `atlas_sql_db`, type `fabric-sqldatabase`, `auth.type: application`, operations read, create, update, delete. Narrowing it to `read` is APP-2 step 3 (decision of 13 Nov; the Notes test page still saves through `create` until then).

## 4. Read path (connector)

1. `rayfin/connectors/atlas_sql_db/TestNote.ts` declares the entity for `dbo.TestNote` (authenticated users: read, create).
2. `packages/frontend/src/lib/connectors.ts` is **hand-maintained** (its generated block was removed on purpose). It lists the connector, its operations (`read`, `create`) and each entity's fields by name, because the decorated classes live outside the frontend package.
3. `packages/frontend/src/lib/rayfin-client.ts` builds `ConnectorsRayfinClient<UniversalAppSchema, AppFunctionsSchema, AppConnectorsSchema>`. **The functions pack overwrote this file** with the plain `RayfinClient` (it picks that variant because `connectors` is not in `rayfinPacks`; the connector was added by hand), which dropped the connector. It was restored to the template's connectors-plus-functions shape (`.agents/skills/connectors/kit/rayfin-client.with-functions.ts`). If a pack is applied again, check this file afterwards.
4. `packages/frontend/src/components/notes.component.tsx` reads and writes `TestNote` through `getRayfinClient().connectors.atlas_sql_db.TestNote`.
5. `rayfin/connectors/atlas_sql_db/metadata.json` has `schemas: []`: the connector's table list has not been rediscovered since 10 Nov. APP-2 refreshes it when views exist (RB-05).

## 5. Write path (functions)

- `packages/functions/src/function_app.ts` registers the functions. Rayfin's type generation reads each handler **inline** (an arrow function written inside `udf.func`), so handlers stay in this file and delegate to modules.
- Modules: `config.ts` (SQL server and database identifiers, no secrets), `identity.ts` (decode the caller's token claims), `sql.ts` (open a connection with `mssql` and the app identity's token, describe errors without leaking the token), `spikes.ts` (the APP-0 spikes).
- `packages/functions/src/types.ts` is **generated** by `npx rayfin dev functions apply`; never edit it. `scripts/validate-functions.mjs` fails the build if a registered function is missing from it.
- The root `typecheck`, `build` and `build:fabric` scripts build `shared` and `functions` before the frontend, so the frontend can import `AppFunctionsSchema` from `@rayfin-app/functions/types`.
- The frontend calls a function with `(await getRayfinClient()).functions.<name>.invoke()`.
- Spikes: `whoAmI` (S1) and `sqlPing` (S2) are registered. Both and the `#/spikes` page are removed in APP-10.

## 6. Frontend shell

`main.tsx` → `Root.tsx` (theme, error boundary, auth provider, `AuthGate`) → `App.tsx`. Until APP-2 there is no router: `use-hash-route.ts` reads the address bar hash (`#/spikes` shows the spike page in `features/spikes/`; anything else shows Notes), and `App.tsx` has a temporary link for each. Local `npx rayfin dev` signs in automatically through `@microsoft/rayfin-local-dev`.

## 7. Test baseline

`npm test` on 13 Nov before any APP-0 frontend change: 45 passed, **5 failed**, all from template tests that still expect the template's welcome page: `App.spec.tsx` renders `App` without an auth provider (`useAuth must be used within an AuthProvider`) and three tests in `Root.spec.tsx` look for the heading "Your app is taking shape". They fail since the Notes page replaced the welcome page (commit "added notes ui"), not because of the functions pack. They are to be replaced when the app shell lands in APP-2. New APP-0 tests (`use-hash-route.spec.ts`, `spikes.component.spec.tsx`) pass.

After type generation (14 Nov): `npm run typecheck`, `npm run lint`, `npm run build` and `npm run validate:functions` all pass; `npm test` gives 58 passed, 5 failed (the same 5: two in `App.spec.tsx`, three in `Root.spec.tsx`).

## 8. Known drift between notes and code

- `DEPLOY.md` still names the connector `atlassqldb`; the real name is `atlas_sql_db` (`rayfin.yml`).
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
| Functions schema wired back into the client | `packages/frontend/src/lib/rayfin-client.ts` |
| Git-ignore for local seeds and secrets | `.gitignore` |
