import clsx from 'clsx';

import { card } from '@/components/ui';

import type { StageStep, StepState } from './request-model';

/** How each state looks (written out so Tailwind sees every class) and what a screen reader hears. */
const DOT: Record<StepState, { cls: string; word: string }> = {
  done: { cls: 'bg-primary', word: 'done' },
  current: { cls: 'border-2 border-primary bg-card', word: 'current step' },
  upcoming: { cls: 'border border-input bg-card', word: 'not reached yet' },
  returned: { cls: 'bg-info-foreground', word: 'returned for correction here' },
  rejected: { cls: 'bg-destructive', word: 'rejected here' },
  stopped: { cls: 'bg-muted-foreground', word: 'withdrawn here' },
};

/** A 12px dot; the current step pulses softly (not for people who ask for reduced motion). */
function Dot({ state }: { state: StepState }) {
  return (
    <span aria-hidden="true" className={clsx('relative block size-300 shrink-0 rounded-full', DOT[state].cls)}>
      {state === 'current' ? <span className="absolute -inset-[2px] animate-ping rounded-full bg-primary/40 motion-reduce:hidden" /> : null}
    </span>
  );
}

/**
 * Where the request sits, as a clean stepper: the numbered step names across the page, a track under them with a dot
 * per step, and navy progress up to the current step. A request that was returned, rejected or withdrawn stops, in its
 * own colour, at the stage where that happened. Under each name: who did it and when, or who is expected. On a phone
 * the steps stack. The steps, their words and their states all come from the request's data.
 */
export function StageProgress({ steps }: { steps: readonly StageStep[] }) {
  const last = steps.length - 1;
  const reached = Math.max(0, steps.reduce((at, s, i) => (s.state === 'upcoming' ? at : i), 0));

  return (
    <nav aria-label="Request progress" className={`${card} p-500`}>
      {/* A phone: one step per row, a dot beside each. */}
      <ol className="space-y-300 sm:hidden">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-center gap-300">
            <Dot state={s.state} />
            <span className="min-w-0">
              <span className={clsx('block truncate text-300 font-medium', s.state === 'upcoming' && 'text-muted-foreground')}>
                {i + 1}. {s.label}
              </span>
              <span className="block truncate text-200 text-muted-foreground">{s.sub}</span>
              <span className="sr-only">, {DOT[s.state].word}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* Wider: names above a track. The 12px dots sit at even steps from the left edge to the right edge (centres 6px
          in from each end, 6px up); the last step hangs off the end, right-aligned. Each line is lowered by half its
          thickness so it runs through the dot centres; navy reaches the current step. */}
      <div className="relative hidden sm:block">
        <span aria-hidden="true" className="absolute bottom-[calc(0.375rem-0.5px)] left-[0.375rem] right-[0.375rem] h-px bg-border" />
        <span
          aria-hidden="true"
          className="absolute bottom-[calc(0.375rem-1px)] left-[0.375rem] h-[2px] bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `calc((100% - 0.75rem) * ${reached / Math.max(1, last)})` }}
        />
        <ol className="relative grid w-[calc(100%-0.75rem)]" style={{ gridTemplateColumns: `repeat(${last}, minmax(0, 1fr)) 0` }}>
          {steps.map((s, i) => {
            const end = i === last;
            return (
              <li
                key={s.key}
                aria-current={s.state === 'current' ? 'step' : undefined}
                className={end ? 'w-max max-w-[12rem] translate-x-[calc(-100%+0.75rem)] text-right' : 'min-w-0 pr-300 text-left'}
              >
                <span className={clsx('block truncate text-300 font-medium', s.state === 'current' ? 'text-link' : s.state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground')}>
                  {i + 1}. {s.label}
                </span>
                <span className="block truncate text-200 text-muted-foreground">{s.sub}</span>
                <span className="sr-only">, {DOT[s.state].word}</span>
                <span className={clsx('mt-200 block', end && 'ml-auto w-max')}>
                  <Dot state={s.state} />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
