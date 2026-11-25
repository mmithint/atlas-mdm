import { TriangleAlert } from 'lucide-react';

import { hrefFor } from '@/app/router';
import { HEAD_ROW, Pill, TABLE, TD, TH } from '@/components/layout';
import { card } from '@/components/ui';
import { orBlank } from '@/lib/format';

import { InfoTip } from './info-tip.component';
import type { DetailRow, RelatedRow } from './request-api';
import { conflictsOf, dayText } from './request-model';
import { StatusPill } from './status-pill.component';

/**
 * Other requests on this heater or location, conflicts first. A request that is still open and changes the same
 * field is an overlap: the banner says how many, and its row is tinted and tagged. Rows open that request.
 */
export function RelatedRequests({ request, related }: { request: DetailRow; related: readonly RelatedRow[] }) {
  const conflicts = conflictsOf(request, related);
  const conflictIds = new Set(conflicts.map((c) => c.requestId));
  const rank = (r: RelatedRow) => (conflictIds.has(r.requestId) ? 0 : r.fieldCode !== null && r.fieldCode === request.fieldCode ? 1 : 2);
  const rows = [...related].sort((a, b) => rank(a) - rank(b) || (b.requestedAtUtc ?? '').localeCompare(a.requestedAtUtc ?? ''));

  return (
    <div className={`${card} overflow-hidden`}>
      {conflicts.length > 0 ? (
        <p role="status" className="m-300 flex items-center gap-200 rounded-md border border-border bg-card px-300 py-200 text-300">
          <TriangleAlert aria-hidden="true" className="icon-size-300 shrink-0 text-warning-foreground" />
          <span className="font-semibold">
            {conflicts.length} other open {conflicts.length === 1 ? 'request changes' : 'requests change'} this field
          </span>
          <InfoTip text={`Approving this one may overwrite or duplicate ${conflicts.length === 1 ? 'its' : 'their'} change.`} />
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="p-400 text-300 text-muted-foreground">No other request on this heater or location.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <caption className="sr-only">Related requests, those that overlap this one first</caption>
            <thead>
              <tr className={HEAD_ROW}>
                <th scope="col" className={TH}>Request</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Field</th>
                <th scope="col" className={TH}>Source</th>
                <th scope="col" className={TH}>Raised</th>
                <th scope="col" className={TH}>
                  <span className="sr-only">Overlap</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overlaps = conflictIds.has(row.requestId);
                return (
                  <tr key={row.requestId} className="border-t border-divider align-middle hover:bg-row-hover">
                    <th scope="row" className={`${TD} text-left font-medium`}>
                      <a className="id-plate underline-offset-2 hover:underline" href={hrefFor(`/requests/${row.requestId}`)}>
                        {row.requestRef}
                      </a>
                    </th>
                    <td className={TD}>
                      <StatusPill status={row.requestStatus} />
                    </td>
                    <td className={TD}>{orBlank(row.fieldLabel ?? row.fieldCode)}</td>
                    <td className={TD}>{row.sourceLabel}</td>
                    <td className={`${TD} tabular-nums text-muted-foreground`}>{dayText(row.requestedAtUtc)}</td>
                    <td className={TD}>{overlaps ? <Pill tone="neutral">
                          <TriangleAlert aria-hidden="true" className="mr-100 icon-size-100 text-warning-foreground" />
                          Overlaps
                        </Pill> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
