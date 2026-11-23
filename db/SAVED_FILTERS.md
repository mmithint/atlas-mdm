# Equipment filters and saved filters: backend handoff

Written for: the backend developer who connects the Equipment screen's (S-4) Filter panel to real data.

## What the screen does

- **Filter panel.** The Filter button beside Columns opens a panel of checkbox lists, one per field (class, statuses, manufacturer, profit centre, and so on), with counts. Values ticked within one field widen the list (OR); different fields narrow it (AND). Numbers are offered as ranges (Verified: 100%, 50–99%, under 50%).
- **Saved filters.** At the top of the panel. A person saves the whole view under a name and picks it again later, on any device. The view is the header boxes, facility, sort, page size, ticked values and visible columns.

## Saved filters: what is built and what you need to do

> **Until you deploy the backend, saved filters are per browser, not per user.** In the demo (`npm run dev:mock`), the mock functions keep saved filters in the browser's local storage (`atlas.demo.saved-views`). They survive a refresh and Reset demo, but stay on that one browser and are lost when its site data is cleared. The real path below saves **per signed-in user in the database**, on every device. Deploying it replaces the browser storage; the screens need no change.

Everything follows the existing write path: browser → Rayfin function → one stored procedure. The owner is always the verified caller (`trustedAccessToken` → `app.usp_identity_resolve`), never anything the browser sends.

| Layer | File | Status |
| --- | --- | --- |
| Table | `app.saved_view` (migration `0007_notifications.sql`, section 7.3) | **Already in the database.** No migration needed. |
| Procedures | `db/procs/usp_saved_view_list.sql`, `usp_saved_view_save.sql`, `usp_saved_view_delete.sql` | **Run these in ATLAS_SQL_DB** (`CREATE OR ALTER`, safe to rerun). |
| Test | `db/tests/t_saved_views.sql` | Run after the procedures. Rolls everything back. The last line should read `ALL 11 CHECKS PASSED`. |
| Functions | `packages/functions/src/saved-views.ts`, registered in `function_app.ts` | Built and unit-tested (`saved-views.spec.ts`). **Deploy with the next functions release.** |
| Contract | `packages/functions/src/types.ts` (`listSavedViews`, `saveView`, `deleteSavedView`) | Regenerated from the functions. |
| Front end | `packages/frontend/src/features/equipment/saved-views-api.ts`, `saved-views.component.tsx`, `saved-view-model.ts` | Calls the real functions. No change needed when the backend is live. |
| Demo | `packages/frontend/src/dev-mock/mock-functions.ts` | `npm run dev:mock` answers with the same refusals and keeps saved filters **in this browser's local storage** (demo only; see the note above). Not in the production build. |

### Functions

| Function | Input | Procedure |
| --- | --- | --- |
| `listSavedViews` | `screenCode` (`S-4`) | `app.usp_saved_view_list` |
| `saveView` | `screenCode`, `viewName`, `definitionJson` | `app.usp_saved_view_save`. An existing name is replaced; the answer's `outcome` is `CREATED` or `REPLACED`. |
| `deleteSavedView` | `savedViewId` | `app.usp_saved_view_delete` (own views only) |

### Refusals (the procedures' own words reach the screen)

| Number | Meaning |
| --- | --- |
| 50341 | The caller is not a person (blank, no @, or a `system:` address). |
| 50342 | The screen is not S-2 or S-4. |
| 50343 | The name is blank or longer than 100 characters. |
| 50344 | The definition is not JSON or longer than 4,000 characters. |
| 50345 | The person already has 50 saved filters on this screen. A new name is refused; replacing an existing one still works. |
| 50346 | No such saved filter of yours. Someone else's view gets the same answer, so it never reveals that one exists. |

### Definition format (`definition_json`)

The screen writes and reads it (`saved-view-model.ts`); the database only checks `ISJSON`. Example:

```json
{"v":1,"query":{"f.manufacturer":"demo","size":"25"},"selection":{"equipClass":["LINE_HEATER"]},"columns":["equipmentTagNumber","manufacturer","equipClass"]}
```

- `query` is the same address query the screen already uses (`f.<column>` header boxes, `facility`, `sort`, `dir`, `size`).
- `selection` maps facet ids to ticked values. `__blank__` stands for "Not set"; Verified uses `done`, `part` and `low`; Open requests uses `none` and `some`.
- `columns` lists the visible columns.
- Reading a definition back drops anything unknown, so old or hand-edited definitions never break the screen.
- `is_default` is in the table but not used yet. It is ready for an "open with this view" option.

## The Filter panel's checkboxes: one limit to know

`app.usp_equipment_search` only supports the header boxes' "contains" filters, and this work kept the backend unchanged. So the checkboxes are matched **in the browser**: opening the panel reads every row that matches the header boxes, facility and sort (100 rows per call, 4 calls at a time, `use-filtered-search.ts`). It then counts, filters and pages them. Above **2,000 matching heaters**, the panel asks the person to narrow the search first.

To lift that limit with real data volumes, move the checkboxes into the procedure:

1. Add a `@facets_json` parameter to `app.usp_equipment_search`, holding the panel's `selection` (OR within a field, AND across fields). Then add it to the `searchEquipment` function.
2. Return the per-field value counts from a procedure, so the panel needn't read every row.
3. In the front end, `useFilteredSearch` is the only place that changes: pass the selection to `fetchSortedPage` and drop the read-everything step. The panel and its props stay as they are.

## How to check it end to end

1. Run the three procedures, then `t_saved_views.sql`.
2. Deploy the functions.
3. Sign in, open Equipment, then Filter. Tick a value, choose the save icon, give a name, and choose Save filter.
4. Reload, or sign in on another device. Open Filter and choose the name under Saved filters. The boxes, sort, ticked values and columns come back.
