import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, card } from '@/components/ui';
import { hrefFor } from '@/app/router';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, orBlank } from '@/lib/format';

import { fetchEquipmentRequests, type RelatedRequestRow } from './change-request-api';

/** A request status in the words people use; the badge colour says whether it still needs someone. */
function statusBadge(status: string): { text: string; className: string } {
  switch (status) {
    case 'PENDING_RESPONSIBLE':
      return { text: 'Waiting for the responsible stage', className: badge.warning };
    case 'PENDING_ACCOUNTABLE':
      return { text: 'Waiting for the accountable stage', className: badge.warning };
    case 'RETURNED':
      return { text: 'Returned for correction', className: badge.warning };
    case 'APPROVED':
      return { text: 'Approved', className: badge.success };
    case 'REJECTED':
      return { text: 'Rejected', className: badge.neutral };
    case 'CANCELLED':
      return { text: 'Withdrawn', className: badge.neutral };
    case 'DRAFT':
      return { text: 'Draft', className: badge.neutral };
    default:
      return { text: status.toLowerCase().replace(/_/g, ' '), className: badge.neutral };
  }
}

/**
 * S-5 "Requests on this heater": every change request on the heater and on its functional location, open ones
 * first, each linking to its page (S-3). Everyone can read it (open visibility, POC-APP-04). `reloadKey` changes
 * when a request was just created from the dialog, so the new one appears without a page reload.
 */
export function EquipmentRequests({ equipmentId, reloadKey }: { equipmentId: number; reloadKey: number }) {
  const state = useLoad(`equipment-requests:${equipmentId}:${reloadKey}`, () => fetchEquipmentRequests(equipmentId));

  return (
    <section aria-labelledby="requests-title" className={card}>
      <div className="border-b border-border px-400 py-300">
        <h2 id="requests-title" className="text-400 font-semibold">
          Requests on this heater
        </h2>
        <p className="mt-100 text-200 text-muted-foreground">
          Every change proposed to this heater or to its functional location, open requests first. Open one to see who approved what.
        </p>
      </div>

      <div className="p-400">
        {state.status === 'loading' ? <LoadingState rows={2} label="Loading the requests" /> : null}
        {state.status === 'error' ? (
          <ErrorState title="The requests could not be loaded" message={state.message} onRetry={state.retry} />
        ) : null}
        {state.status === 'ready' && state.data.rows.length === 0 ? (
          <EmptyState title="No requests yet" hint="Nobody has proposed a change to this heater or its location." />
        ) : null}
        {state.status === 'ready' && state.data.rows.length > 0 ? (
          <RequestsTable rows={state.data.rows} totalCount={state.data.totalCount} />
        ) : null}
      </div>
    </section>
  );
}

function RequestsTable({ rows, totalCount }: { rows: readonly RelatedRequestRow[]; totalCount: number }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-300">
          <caption className="sr-only">Change requests on this heater</caption>
          <thead>
            <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-300 py-200 font-semibold">Request</th>
              <th scope="col" className="px-300 py-200 font-semibold">Field</th>
              <th scope="col" className="px-300 py-200 font-semibold">Status</th>
              <th scope="col" className="px-300 py-200 font-semibold">Source</th>
              <th scope="col" className="px-300 py-200 font-semibold">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = statusBadge(r.requestStatus);
              return (
                <tr key={r.requestId} className="border-t border-border align-top">
                  <th scope="row" className="px-300 py-200 text-left font-medium">
                    <a
                      className="id-plate text-brand-foreground underline-offset-2 hover:underline"
                      href={hrefFor(`/requests/${r.requestId}`)}
                    >
                      {r.requestRef}
                    </a>
                  </th>
                  <td className="px-300 py-200">
                    <span className="flex flex-wrap items-center gap-200">
                      {r.fieldLabel ?? r.fieldCode ?? BLANK}
                      {r.equipmentId === null ? (
                        <span className={badge.neutral} title="This request is about the functional location, not the heater itself">
                          location
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-300 py-200">
                    <span className="flex flex-wrap items-center gap-200">
                      <span className={status.className}>{status.text}</span>
                      {r.otherOpenRequestsSameField > 0 ? (
                        <span
                          className={badge.warning}
                          title={`${r.otherOpenRequestsSameField} other open request(s) target the same field`}
                        >
                          overlaps another open request
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-300 py-200">{orBlank(r.sourceLabel)}</td>
                  <td className="px-300 py-200 text-muted-foreground">{formatUtc(r.requestedAtUtc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalCount > rows.length ? (
        <p className="mt-300 text-200 text-muted-foreground">
          Showing {rows.length} of {totalCount} requests (the newest, open ones first).
        </p>
      ) : null}
    </>
  );
}
