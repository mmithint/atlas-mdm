import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';

import { Panel, Pill } from '@/components/layout';
import { formatUtc, isBlank } from '@/lib/format';

import { InfoTip } from './info-tip.component';
import type { DetailRow } from './request-api';
import { actorText } from './request-model';

/** The most photo tiles drawn; the count above them says how many there are. */
const MAX_TILES = 4;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Why the change was asked for, in one block: the reason as a quote, the note, and the comment from creation only
 * when it says something else (the reason and the comment are often the same words). Under it, in muted text, who
 * raised it, when, and where it came from. The evidence sits beside it, so nothing is a click away.
 */
export function WhyAndEvidence({ request }: { request: DetailRow }) {
  const reason = isBlank(request.reason) ? null : String(request.reason).trim();
  const note = isBlank(request.note) ? null : String(request.note).trim();
  const created = isBlank(request.creationComment) ? null : String(request.creationComment).trim();
  const extra = [
    note && !same(note, reason) ? { label: 'Note', text: note } : null,
    created && !same(created, reason) && !same(created, note) ? { label: 'When it was created', text: created } : null,
  ].filter((x): x is { label: string; text: string } => x !== null);

  return (
    <Panel title="Why this change">
      <div className="grid gap-500 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        {reason ? (
          <blockquote className="mt-200 border-l-2 border-ring pl-300 text-400 leading-400">“{reason}”</blockquote>
        ) : (
          <p className="mt-200 text-300 text-muted-foreground">No reason was given.</p>
        )}
        {extra.length > 0 ? (
          <dl className="mt-300 space-y-200">
            {extra.map((e) => (
              <div key={e.label}>
                <dt className="text-200 text-muted-foreground">{e.label}</dt>
                <dd className="break-words text-300">{e.text}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <dl className="mt-400 grid gap-300 border-t border-divider pt-300 text-300 sm:grid-cols-3">
          <Fact label="Raised by">{actorText(request.requestedBy)}</Fact>
          <Fact label="Submitted">{formatUtc(request.requestedAtUtc)}</Fact>
          <Fact label="Detected by">
            {request.sourceLabel}
            {request.detectedAtUtc ? <span className="block text-muted-foreground">{formatUtc(request.detectedAtUtc)}</span> : null}
          </Fact>
        </dl>
      </div>
      <EvidenceGallery count={request.photoCount} />
      </div>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/**
 * The photos linked to the request. Only the count is known here (the pictures themselves arrive with the Field
 * view, APP-7), so each photo is a placeholder tile and a request with none says so plainly.
 */
export function EvidenceGallery({ count }: { count: number }) {
  return (
    <div className="min-w-0">
      <h2 className="flex items-center gap-100 text-200 font-medium uppercase tracking-wide text-muted-foreground">
        Evidence · {count} {count === 1 ? 'photo' : 'photos'}
        <InfoTip
          text={count === 0 ? 'No photo is attached to this request.' : `Previews arrive with the Field view; ${count === 1 ? 'the photo is' : 'the photos are'} linked to this request already.`}
        />
      </h2>
      {count === 0 ? (
        <div className="mt-200">
          <Pill tone="warning">Evidence missing</Pill>
        </div>
      ) : (
        <ul className="mt-200 grid grid-cols-2 gap-200" aria-label="Photos linked to this request">
          {Array.from({ length: Math.min(count, MAX_TILES) }, (_, i) => (
            <li
              key={i}
              className="flex aspect-[4/3] flex-col items-center justify-center gap-100 rounded-lg border border-border bg-muted p-200 text-center text-200 text-muted-foreground"
            >
              <ImageOff aria-hidden="true" className="icon-size-300" />
              Photo {i + 1}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
