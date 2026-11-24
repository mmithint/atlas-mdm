import clsx from 'clsx';
import { useId, type KeyboardEvent, type ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** A form question with a few answers: native radio buttons in a fieldset (the keyboard and screen readers know them). */
export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: {
  legend: string;
  options: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="text-300 font-medium">{legend}</legend>
      <div className="mt-100 flex flex-wrap gap-x-600">
        {options.map((o) => (
          <label key={o.value} className="inline-flex min-h-11 cursor-pointer items-center gap-200 text-300">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="icon-size-200 accent-primary" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export interface ChipChoice<T extends string> extends Choice<T> {
  icon: ReactNode;
  /** Classes of the chip when it is chosen (a status tint). */
  chosen: string;
}

/**
 * Single-select choice chips (the radio group pattern): separate rounded chips with icon and text, 32px tall, one
 * tab stop, arrow keys move and choose. The chosen chip takes its own status tint, so the answer reads at a glance
 * and never by colour alone.
 */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly ChipChoice<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const index = options.findIndex((o) => o.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(Math.max(index, 0) + step + options.length) % options.length]!;
    onChange(next.value);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap gap-200">
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={checked}
            tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={clsx(
              'inline-flex min-h-800 items-center gap-100 rounded-full border px-300 text-250 font-medium transition-colors duration-150 motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              checked ? o.chosen : 'border-border bg-card text-foreground hover:border-input hover:bg-hover'
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
