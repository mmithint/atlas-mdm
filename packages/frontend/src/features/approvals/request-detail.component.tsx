import { ArrowLeft, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { hrefFor } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { button } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';

import { DecisionPanel } from './decision-panel.component';
import { fetchRequest, refreshChecks, type CheckRow, type RequestView } from './request-api';
import { ageText, isClosed, requestTitle, type ResultBanner } from './request-model';
import { RequestTabs } from './request-tabs.component';

/**
 * S-3 Request detail (POC-APP-09, 11, 12): one change request in full, the live approval checks, the history,
 * and the decision panel. Everything the page shows, including what this person may do, comes from one call to
 * the server (`getRequestDetail`, read path C / D-17); the evidence snapshot is read beside it and may fail on
 * its own without hiding the request. Approving, rejecting, returning and withdrawing are checked again by the
 * procedures, so a stale page can never do what the person was not allowed to do.
 */
export function RequestDetail({ idText }: { idText: string }) {
  const valid = /^\d+$/.test(idText) && Number.isSafeInteger(Number(idText)) && Number(idText) >= 1;
  const requestId = valid ? Number(idText) : -1;
  const state = useLoad(`request:${requestId}`, () => (valid ? fetchRequest(requestId) : Promise.resolve(null)));

  return (
    <div className="space-y-400">
      <nav aria-label="Breadcrumb">
        <a className="inline-flex items-center gap-100 text-300 font-medium text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/approvals')}>
          <ArrowLeft aria-hidden="true" className="icon-size-200" />
          Approvals
        </a>
      </nav>

      {state.status === 'loading' ? <LoadingState rows={6} label="Loading the request" /> : null}
      {state.status === 'error' ? (
        <ErrorState title="The request could not be loaded" message={state.message} onRetry={state.retry} />
      ) : null}
      {state.status === 'ready' && state.data === null ? <NoSuchRequest idText={idText} /> : null}
      {state.status === 'ready' && state.data !== null ? <Loaded initial={state.data} requestId={requestId} /> : null}
    </div>
  );
}

function NoSuchRequest({ idText }: { idText: string }) {
  return (
    <EmptyState
      title="No such request"
      hint={`There is no request with the number "${idText}". The link may be wrong.`}
      action={
        <a className={button.secondary} href={hrefFor('/approvals')}>
          Back to the approvals
        </a>
      }
    />
  );
}

function Loaded({ initial, requestId }: { initial: RequestView; requestId: number }) {
  const [view, setView] = useState<RequestView>(initial);
  const [gone, setGone] = useState(false);
  const [banner, setBanner] = useState<ResultBanner | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // "Check again" replaces the checks until the request itself is read again; derived, so no effect is needed.
  const [again, setAgain] = useState<{ base: readonly CheckRow[]; rows: CheckRow[] } | null>(null);
  const checks = again !== null && again.base === view.checks ? again.rows : view.checks;

  // Reads the request again without blanking the page, so the banner and the person's place survive.
  const reload = useCallback(async () => {
    setReloadError(null);
    try {
      const next = await fetchRequest(requestId);
      if (next === null) setGone(true);
      else setView(next);
    } catch (error) {
      setReloadError(errorText(error));
    }
  }, [requestId]);

  const onDone = (result: ResultBanner) => {
    setBanner(result);
    void reload();
  };

  const onRecheck = async () => {
    const rows = await refreshChecks(requestId);
    setAgain({ base: view.checks, rows });
  };

  if (gone) return <NoSuchRequest idText={String(requestId)} />;

  const { request } = view;
  const open = !isClosed(request.requestStatus);
  const age = open ? ageText(request.ageHours) : null;

  return (
    <>
      {banner !== null ? <Banner banner={banner} onDismiss={() => setBanner(null)} /> : null}
      {reloadError !== null ? (
        <ErrorState title="The request could not be refreshed" message={reloadError} onRetry={() => void reload()} />
      ) : null}

      {/* The decision buttons sit on the same row as the header; they wrap below it only on a narrow screen. */}
      <div className="flex flex-wrap items-start justify-between gap-300">
        <header className="min-w-0 flex-1 space-y-200">
          <h1 className="break-words text-600 font-semibold">{requestTitle(request)}</h1>
          <p className="flex flex-wrap items-center gap-200">
            <span className="id-plate">{request.requestRef}</span>

            {request.equipmentNumber ? (
              request.equipmentId !== null ? (
                <a
                  className="id-plate underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={hrefFor(`/equipment/${request.equipmentId}`)}
                  title="Open the heater"
                >
                  {request.equipmentNumber}
                </a>
              ) : (
                <span className="id-plate" title="Equipment number">{request.equipmentNumber}</span>
              )
            ) : null}
            {request.equipmentTagNumber ? <span className="id-plate" title="Engineering tag">{request.equipmentTagNumber}</span> : null}
            {request.functionalLocation ? <span className="id-plate" title="Functional location">{request.functionalLocation}</span> : null}
            {/* {request.sapField ? <span className="id-plate" title="SAP field this changes">{request.sapField}</span> : null} */}
            {/* <p className="flex flex-wrap items-center gap-200"> */}
            {/* <StatusBadge status={request.requestStatus} /> */}
            {age !== null ? <span className="text-200 text-muted-foreground">open for {age}</span> : null}
            {/* </p> */}
          </p>
        </header>

        <DecisionPanel request={request} viewer={view.viewer} checks={checks} returnCandidates={view.returnCandidates} onDone={onDone} />
      </div>

      <RequestTabs view={view} checks={checks} onRecheck={onRecheck} />
    </>
  );
}

function Banner({ banner, onDismiss }: { banner: ResultBanner; onDismiss: () => void }) {
  const warning = banner.tone === 'warning';
  const Icon = warning ? TriangleAlert : CircleCheck;
  return (
    <div
      role="status"
      className={`flex items-start gap-300 rounded-lg px-400 py-300 text-300 ${warning ? 'bg-warning text-warning-foreground' : 'bg-success text-success-foreground'}`}
    >
      <Icon aria-hidden="true" className="icon-size-300 mt-100 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{banner.title}</p>
        {banner.detail ? <p className="mt-100">{banner.detail}</p> : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss this message"
        onClick={onDismiss}
        className="rounded-md p-100 hover:bg-hover-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden="true" className="icon-size-200" />
      </button>
    </div>
  );
}
