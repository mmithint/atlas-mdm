import clsx from 'clsx';

import { STEPS, type Step } from './model';

/**
 * The steps across the top: names in a row, left-aligned, a track with a dot under each. Done steps are solid navy dots on a
 * navy line and go back on click; the current step is a navy ring with its name in navy; the ones ahead are grey.
 * A step that does not apply (Verify, for missing or new equipment) has a dashed dot and says "Not needed".
 * On a phone it reads "Step 2 of 4 · Equipment".
 */
export function FieldViewStepper({ current, skipped, onGo }: { current: Step; skipped: readonly Step[]; onGo: (step: Step) => void }) {
  const last = STEPS.length - 1;
  const reached = (current - 1) / last;
  return (
    <nav aria-label="Field view steps">
      <p className="text-300 font-medium sm:hidden">
        Step {current} of {STEPS.length} · {STEPS.find((s) => s.step === current)?.label}
      </p>
      <div className="relative hidden sm:block">
        {/* Full width: the 12px dots sit at even steps from the left edge to the right edge (their centres 6px in
            from each end, 6px up). The grid spans the width less one dot, so dot k is at k/last of it; the last step
            hangs off its end, right-aligned. Each line is lowered by half its thickness to run through the centres. */}
        <span aria-hidden="true" className="absolute bottom-[calc(0.375rem-0.5px)] left-[0.375rem] right-[0.375rem] h-px bg-border" />
        <span
          aria-hidden="true"
          className="absolute bottom-[calc(0.375rem-1px)] left-[0.375rem] h-[2px] bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `calc((100% - 0.75rem) * ${reached})` }}
        />
        <ol className="relative grid w-[calc(100%-0.75rem)]" style={{ gridTemplateColumns: `repeat(${last}, minmax(0, 1fr)) 0` }}>
          {STEPS.map((s) => {
            const isSkipped = skipped.includes(s.step);
            const isEnd = s.step === STEPS.length;
            const state = s.step === current ? 'current' : s.step < current && !isSkipped ? 'done' : 'upcoming';
            const body = (
              <>
                <span className={clsx('block truncate text-300', isEnd && 'text-right', state === 'current' ? 'font-medium text-link' : 'text-muted-foreground', state === 'done' && 'group-hover:text-foreground')}>
                  {s.step}. {s.label}
                </span>
                <span className={clsx('block h-200 text-100 leading-200 text-muted-foreground', isEnd && 'text-right')}>{isSkipped ? 'Not needed' : ''}</span>
                <span
                  aria-hidden="true"
                  className={clsx(
                    'relative mt-100 block size-300 rounded-full',
                    isEnd && 'ml-auto',
                    state === 'done' && 'bg-primary',
                    state === 'current' && 'border-2 border-primary bg-card',
                    state === 'upcoming' && clsx('border border-input bg-card', isSkipped && 'border-dashed')
                  )}
                >
                  {/* The current step pulses softly; nothing moves for people who ask for reduced motion. */}
                  {state === 'current' ? <span className="absolute -inset-[2px] animate-ping rounded-full bg-primary/40 motion-reduce:hidden" /> : null}
                </span>
              </>
            );
            return (
              <li key={s.step} className={isEnd ? 'w-max translate-x-[calc(-100%+0.75rem)] text-right' : 'min-w-0 pr-300 text-left'}>
                {state === 'done' ? (
                  <button
                    type="button"
                    onClick={() => onGo(s.step)}
                    aria-label={`${s.label}, done. Go back to this step`}
                    className="group w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {body}
                  </button>
                ) : (
                  <span className="block" aria-current={state === 'current' ? 'step' : undefined}>
                    {body}
                    <span className="sr-only">{state === 'current' ? ', current step' : isSkipped ? ', not needed' : ', not reached yet'}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
