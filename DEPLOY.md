# ATLAS-DEV: run and deploy (Oxy ATLAS workspace)

This is the ATLAS Fabric App for Oxy. Right now it is a small test page:
- Fabric sign-in.
- "Welcome, <your name>".
- A **Comment** box. **Submit** saves the comment to the Fabric SQL database **ATLAS_SQL_DB**, table `dbo.TestNote`:
  - `title` = the comment
  - `createdBy` = the signed-in email
  - `createdAt` = the submit time
- Below the box, the latest 20 comments read back from that table.

## Where things are

| What | Value |
|---|---|
| Tenant (Oxy) | `24df34ab-a358-4b62-ba14-e5dfb43b9d63` |
| Workspace | ATLAS · `918924c8-a56a-41a9-b1fe-f6bfcd07c3c5` |
| App item | ATLAS_DEV · `46cedde1-9918-4e7a-ac33-4ebb39a68bdc` |
| Database | ATLAS_SQL_DB · `a832d11c-c075-46a5-95c5-8473cff8bf44`, table `dbo.TestNote` |
| Live URL | https://sure-heron-7bbbf23a44-northcentralus.webapp.fabricapps.net |

## Prerequisites
- Node.js 20 or later, plus Git.
- An Oxy (or guest) account with **Contributor or higher** on the ATLAS workspace.
- In Oxy's Fabric tenant settings, your account (or a group you are in) must be allowed:
  - **Enable Fabric App Items (preview)**
  - **SQL database in Fabric**

## First time on your machine

```bash
git clone https://github.com/mmithint/atlas-mdm.git
cd atlas-mdm
npx npm@11 install        # npm 10 fails with "edgesOut"; npm 11 works
npx rayfin login -t 24df34ab-a358-4b62-ba14-e5dfb43b9d63
npx rayfin up --tenant 24df34ab-a358-4b62-ba14-e5dfb43b9d63 --workspace-id 918924c8-a56a-41a9-b1fe-f6bfcd07c3c5 --yes
```

`--yes` reuses the existing **ATLAS_DEV** app instead of asking. You only need it on the first deploy, because `rayfin/.env` is created on your machine and is not stored in Git.

## Every deploy after that

```bash
git pull                  # always deploy the latest shared code; the last deploy wins
npx rayfin login -t 24df34ab-a358-4b62-ba14-e5dfb43b9d63   # if your sign-in expired
npx rayfin up --tenant 24df34ab-a358-4b62-ba14-e5dfb43b9d63
```

## Run locally

```bash
npm run dev               # UI on http://localhost:5173, using the Fabric backend
npm test                  # unit tests
```

## Known blockers (Nov 11, 2026)

Deploying with the database connection failed for a Bizmetric guest account:

> Runtime settings sync failed: 403 Forbidden: "The project settings could not be saved because of a configuration or quota restriction."
> RootActivityId 8183262b-fec8-488b-ad17-e4938caa4348

An earlier attempt using the app's own database failed with "The SQLDatabase feature is not enabled" (RootActivityId 1ad609f0-5095-4c9d-8f00-5e218d9887a6).

The fix is a tenant setting: add the deploying accounts to the group allowed by **Enable Fabric App Items (preview)** and **SQL database in Fabric**.

## Code map

- `packages/frontend/src/App.tsx`: the page and the Comment box.
- `rayfin/rayfin.yml`: Fabric settings, including the `atlassqldb` connector (read and create).
- `rayfin/connectors/atlassqldb/`: the `TestNote` table definition and the table list discovered from ATLAS_SQL_DB.
- `packages/frontend/src/lib/connectors.ts`: connects the UI to `atlassqldb`.
