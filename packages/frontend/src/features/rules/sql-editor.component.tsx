import { useRef } from 'react';

/**
 * A monospace SQL box with line numbers (REF-52 §9.3). A plain text area on purpose: no editor library for one
 * screen. Lines do not wrap, so the numbers stay next to their line; the gutter follows the scroll.
 */
export function SqlEditor({
  id,
  value,
  onChange,
  readOnly = false,
  label,
  rows = 18,
}: {
  id: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  label: string;
  rows?: number;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = Math.max(value.split('\n').length, rows);
  return (
    <div className="flex overflow-hidden rounded-md border border-input bg-card font-mono text-200 leading-200 focus-within:ring-2 focus-within:ring-ring">
      <div ref={gutter} aria-hidden="true" className="select-none overflow-hidden border-r border-border bg-muted px-200 py-200 text-right text-muted-foreground" style={{ maxHeight: `${rows * 16 + 16}px` }}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        id={id}
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        wrap="off"
        rows={rows}
        className="min-w-0 flex-1 resize-y bg-transparent px-300 py-200 font-mono text-200 leading-200 text-foreground focus-visible:outline-none"
      />
    </div>
  );
}
