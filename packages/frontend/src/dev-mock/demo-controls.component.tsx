import { RotateCcw, UserRound } from 'lucide-react';
import { useState } from 'react';

import { button } from '@/components/ui';

import { resetDemo } from './demo-store';
import { currentPersona, PERSONAS, setPersona, type PersonaId } from './personas';

/**
 * The presenter's two controls in the sidebar (FINAL PLAN/11 §3 F4 and F5), `npm run dev:mock` only:
 * "View as" switches between the five demo personas, and Reset demo puts the sample data back to its start.
 * Both call `onChange` so the shell reloads the profile and the current page.
 */
export default function DemoControls({ onChange }: { onChange: () => void }) {
  const [persona, setLocal] = useState<PersonaId>(currentPersona().id);

  return (
    <div className="space-y-200 rounded-lg border border-dashed border-sidebar-border p-200" aria-label="Demo controls">
      <label htmlFor="demo-persona" className="flex items-center gap-100 text-200 text-sidebar-muted">
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
        className="w-full rounded-md border border-input bg-card px-200 py-100 text-200 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className={`${button.small} w-full`}
        onClick={() => {
          resetDemo();
          onChange();
        }}
        title="Put the sample data back to how it started (the persona stays)"
      >
        <RotateCcw aria-hidden="true" className="icon-size-100" />
        <span>Reset demo</span>
      </button>
    </div>
  );
}
