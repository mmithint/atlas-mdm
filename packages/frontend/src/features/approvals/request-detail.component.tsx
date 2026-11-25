import { ArrowLeft, ArrowRight, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { hrefFor } from '@/app/router';
import { EmptyState, ErrorState } from '@/components/states';
import { button, card } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';

import { DecisionActions } from './action-panel.component';
import { ActivityTimeline } from './activity-timeline.component';
import { ChangeDiffCard } from './change-diff-card.component';
import { ApprovalHeader } from './request-header.component';
import { fetchRequest, refreshChecks, type CheckRow, type RequestView } from './request-api';
import { conflictsOf, stageSteps, type ResultBanner } from './request-model';
import { RequestTabs } from './request-tabs.component';
import { RuleCheck } from './rule-check.component';
import { StageProgress } from './stage-progress.component';
import { openRequest, useQueueKeys, useQueuePosition, type QueuePosition } from './use-queue-position';
import { WhyAndEvidence } from './why-evidence.component';

/**
 * S-3 Request detail (POC-APP-09, 11, 12): one change request, laid out so an approver can decide without opening
 * another tab. Left: where it sits (progress), the change itself with its checks, why it was asked for with the
 * evidence, and, in tabs, the related requests, the equipment and the history. Right, sticky: the decision and the
 * activity (a fixed 22rem column). The decision buttons sit in the header under Previous and Next. Everything the page shows, including what this person may do, comes from one call to the server
 * (`getRequestDetail`, read path C / D-17); the evidence is read beside it and may fail on its own. Approving,
 * rejecting, returning and withdrawing are checked again by the procedures, so a stale page can never do what the
 * person was not allowed to do. J and K step through the person's queue.
 */
export function RequestDetail({ idText }: { idText: string }) {
  const valid = /^\d+$/.test(idText) && Number.isSafeInteger(Number(idText)) && Number(idText) >= 1;
  const requestId = valid ? Number(idText) : -1;
  const state = useLoad(`request:${requestId}`, () => (valid ? fetchRequest(requestId) : Promise.resolve(null)));

  return (
    <div className="space-y-400">
      <nav aria-label="Back to the list">
        <a className="inline-flex items-center gap-100 text-300 font-medium text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/approvals')}>
          <ArrowLeft aria-hidden="true" className="icon-size-200" />
          Approvals
        </a>
      </nav>

      {state.status === 'loading' ? <RequestSkeleton /> : null}
      {state.status === 'error' ? <ErrorState title="The request could not be loaded" message={state.message} onRetry={state.retry} /> : null}
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

/** The shape of the page while it loads, so nothing jumps when the request arrives. */
function RequestSkeleton() {
  const bar = (w: string, h = 'h-300') => <span className={`block ${h} ${w} rounded-md bg-muted`} />;
  return (
    <div role="status" aria-busy="true" aria-label="Loading the request" className="animate-pulse space-y-400 motion-reduce:animate-none">
      <div className="space-y-300">
        {bar('w-1/2', 'h-600')}
        {bar('w-3/4')}
      </div>
      <div className={`${card} h-800 p-400`} />
      <div className="grid gap-400 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-400">
          <div className={`${card} h-60 p-500`} />
          <div className={`${card} h-40 p-500`} />
        </div>
        <div className={`${card} h-80 p-500`} />
      </div>
    </div>
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

  // Where this request sits in the person's queue, read once (before any decision moves it out of the queue).
  const queue = useQueuePosition(requestId, initial.request.requestStatus);
  useQueueKeys(queue);

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
  const conflicts = conflictsOf(request, view.related);

  return (
    <>
      {banner !== null ? <Banner banner={banner} queue={queue} onDismiss={() => setBanner(null)} /> : null}
      {reloadError !== null ? <ErrorState title="The request could not be refreshed" message={reloadError} onRetry={() => void reload()} /> : null}

      <ApprovalHeader
        request={request}
        queue={queue}
        actions={<DecisionActions request={request} viewer={view.viewer} checks={checks} returnCandidates={view.returnCandidates} conflicts={conflicts} onDone={onDone} />}
      />
      <StageProgress steps={stageSteps(request, view.events)} />

      <div className="grid items-start gap-400 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-400">
          <ChangeDiffCard request={request} gold={view.gold} checks={checks} footer={<RuleCheck checks={checks} onRecheck={onRecheck} />} />
          <WhyAndEvidence request={request} />
          <RequestTabs view={view} checks={checks} onRecheck={onRecheck} />
        </div>

        {/* The activity stays in view on a wide screen; below 1024px it follows the content. */}
        <aside className="min-w-0 lg:sticky lg:top-0 lg:-mx-100 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:px-100 lg:pb-100">
          <ActivityTimeline request={request} events={view.events} viewer={view.viewer} />
        </aside>
      </div>
    </>
  );
}

/** The sentence a decision produced, with the way on to the next request in the queue when there is one. */
function Banner({ banner, queue, onDismiss }: { banner: ResultBanner; queue: QueuePosition | null; onDismiss: () => void }) {
  const warning = banner.tone === 'warning';
  const Icon = warning ? TriangleAlert : CircleCheck;
  return (
    <div role="status" className={`flex flex-wrap items-start gap-300 rounded-lg px-400 py-300 text-300 ${warning ? 'bg-warning text-warning-foreground' : 'bg-success text-success-foreground'}`}>
      <Icon aria-hidden="true" className="icon-size-300 mt-100 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{banner.title}</p>
        {banner.detail ? <p className="mt-100">{banner.detail}</p> : null}
      </div>
      {queue?.nextId != null ? (
        <button type="button" className={button.primary} onClick={() => openRequest(queue.nextId as number)}>
          Next request
          <ArrowRight aria-hidden="true" className="icon-size-200" />
          <kbd className="rounded-sm border border-current/40 px-100 text-100 leading-200">J</kbd>
        </button>
      ) : null}
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
