import { RotateCcw, UserRound } from 'lucide-react';
import { useState } from 'react';

import { button } from '@/components/ui';

import { resetDemo } from './demo-store';
import { currentPersona, PERSONAS, setPersona, type PersonaId } from './personas';

/**
 * The presenter's two controls in the header (FINAL PLAN/11 §3 F4 and F5), `npm run dev:mock` only:
 * "View as" switches between the five demo personas, and Reset demo puts the sample data back to its start.
 * Both call `onChange` so the shell reloads the profile and the current page.
 */
export default function DemoControls({ onChange }: { onChange: () => void }) {
  const [persona, setLocal] = useState<PersonaId>(currentPersona().id);

  return (
    <div className="flex items-center gap-200 rounded-md border border-dashed border-border px-200 py-100" aria-label="Demo controls">
      <label htmlFor="demo-persona" className="hidden items-center gap-100 text-200 text-muted-foreground lg:flex">
        <UserRound aria-hidden="true" className="icon-size-200" />
        View as
      </label>
      <select
        id="demo-persona"
        value={persona}
        onChange={(event) => {
          const id = event.target.value as PersonaId;
          setPersona(id);
          setLocal(id);
          onChange();
        }}
        className="rounded-md border border-input bg-card px-200 py-100 text-200 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title="Which demo person the app answers for"
      >
        {PERSONAS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={button.small}
        onClick={() => {
          resetDemo();
          onChange();
        }}
        title="Put the sample data back to how it started (the persona stays)"
      >
        <RotateCcw aria-hidden="true" className="icon-size-100" />
        <span className="hidden sm:inline">Reset demo</span>
      </button>
    </div>
  );
}
