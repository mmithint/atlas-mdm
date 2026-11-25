import clsx from 'clsx';
import { Building2, Hash, MapPin, SearchX, Tag } from 'lucide-react';
import { useId, useState } from 'react';

import { FormField, HEAD_ROW, TABLE, TD, TH } from '@/components/layout';
import { badge, card, input } from '@/components/ui';

import { NEW_EQUIPMENT_CLASSES, type SampleHeater } from './config';
import { fullPath, heatersAt, kindNoun, outcomeOf, type Draft } from './model';
import { RadioGroup } from './choice-controls.component';

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;
const yn = (v: boolean | null) => (v === null ? null : v ? 'yes' : 'no');

const pctTone = (pct: number) => (pct >= 100 ? badge.success : pct < 50 ? badge.warning : badge.neutral);

/** Step 2: is the heater there, is it listed, and which one. */
export function EquipmentStep({ draft, update }: { draft: Draft; update: (change: (d: Draft) => Draft) => void }) {
  const id = useId();
  const outcome = outcomeOf(draft);
  return (
    <section className={`${card} space-y-500 p-500`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-500 font-semibold">
        Find the equipment
      </h2>
      <div className="grid gap-400 sm:grid-cols-2">
        <Question label="Is the equipment on site?" value={yn(draft.onSite)} onChange={(v) => update((d) => ({ ...d, onSite: v === 'yes', inList: v === 'yes' ? d.inList : null }))} />
        {draft.onSite ? <Question label="Is it in the equipment list?" value={yn(draft.inList)} onChange={(v) => update((d) => ({ ...d, inList: v === 'yes' }))} /> : null}
      </div>

      {outcome === 'VERIFY' ? <HeaterList draft={draft} update={update} /> : null}

      {outcome === 'MISSING' ? (
        <div className="space-y-300 rounded-lg border border-warning-border bg-warning p-400">
          <p className="flex items-center gap-200 text-300 font-semibold text-warning-foreground">
            <SearchX aria-hidden="true" className="icon-size-300" />
            Not found
          </p>
          <p className="text-300">A “Missing equipment” request goes for approval when you submit, so the record can be checked.</p>
          <FormField label="Note (optional)" htmlFor={`${id}-missing`} hint="What you saw, e.g. a removed skid or an empty pad.">
            <textarea id={`${id}-missing`} rows={3} className={input} value={draft.missingNote} onChange={(e) => update((d) => ({ ...d, missingNote: e.target.value }))} />
          </FormField>
        </div>
      ) : null}

      {outcome === 'NEW' ? (
        <fieldset className="space-y-300 rounded-lg border border-border p-400">
          <legend className="px-100 text-400 font-semibold">Add new equipment</legend>
          <p className="text-300 text-muted-foreground">A “New equipment” request goes for approval when you submit.</p>
          <div className="grid gap-300 sm:grid-cols-2">
            <FormField label="Equipment class" htmlFor={`${id}-class`}>
              <select id={`${id}-class`} className={input} value={draft.newEquipment.equipClass} onChange={(e) => update((d) => ({ ...d, newEquipment: { ...d.newEquipment, equipClass: e.target.value } }))}>
                <option value="">Choose a class</option>
                {NEW_EQUIPMENT_CLASSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Tag" htmlFor={`${id}-tag`}>
              <input id={`${id}-tag`} className={input} autoComplete="off" value={draft.newEquipment.tag} onChange={(e) => update((d) => ({ ...d, newEquipment: { ...d.newEquipment, tag: e.target.value } }))} />
            </FormField>
            <FormField label="Manufacturer (optional)" htmlFor={`${id}-mfr`}>
              <input id={`${id}-mfr`} className={input} value={draft.newEquipment.manufacturer} onChange={(e) => update((d) => ({ ...d, newEquipment: { ...d.newEquipment, manufacturer: e.target.value } }))} />
            </FormField>
            <FormField label="Notes (optional)" htmlFor={`${id}-notes`}>
              <input id={`${id}-notes`} className={input} value={draft.newEquipment.notes} onChange={(e) => update((d) => ({ ...d, newEquipment: { ...d.newEquipment, notes: e.target.value } }))} />
            </FormField>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}

function Question({ label, value, onChange }: { label: string; value: 'yes' | 'no' | null; onChange: (v: 'yes' | 'no') => void }) {
  return <RadioGroup legend={label} options={YES_NO} value={value} onChange={onChange} />;
}

/** The heaters at the chosen location: search, then pick one (a radio per row). */
function HeaterList({ draft, update }: { draft: Draft; update: (change: (d: Draft) => Draft) => void }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const all = heatersAt(draft.path.SITE);
  const q = query.trim().toLowerCase();
  const rows = q ? all.filter((h) => [h.equipmentNo, h.tag, h.floc, h.manufacturer].some((v) => v.toLowerCase().includes(q))) : all;

  if (all.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-400 text-300 text-muted-foreground">No heaters are listed at this {kindNoun(draft.mode)}. Answer “No” to the list question to add it as new equipment.</p>;
  }
  return (
    <div className="space-y-300">
      <FormField label="Search heaters" htmlFor={id} hint="Equipment number, tag, FLOC or manufacturer">
        <input id={id} type="search" autoComplete="off" className={input} value={query} onChange={(e) => setQuery(e.target.value)} />
      </FormField>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className={TABLE}>
          <caption className="sr-only">Heaters at {draft.path.SITE ? fullPath(draft.path.SITE) : 'this location'}; choose one</caption>
          <thead>
            <tr className={HEAD_ROW}>
              <th className={TH}>
                <span className="sr-only">Choose</span>
              </th>
              <th className={TH}>Equipment no.</th>
              <th className={TH}>Tag</th>
              <th className={TH}>FLOC</th>
              <th className={TH}>Manufacturer</th>
              <th className={TH}>Verified</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const chosen = draft.equipmentNo === h.equipmentNo;
              return (
                <tr key={h.equipmentNo} className={clsx('cursor-pointer border-t border-divider', chosen ? 'bg-sidebar-selected' : 'hover:bg-row-hover')} onClick={() => update((d) => ({ ...d, equipmentNo: h.equipmentNo }))}>
                  <td className={TD}>
                    <input type="radio" name={`${id}-heater`} className="icon-size-200 accent-primary" checked={chosen} onChange={() => update((d) => ({ ...d, equipmentNo: h.equipmentNo }))} aria-label={`${h.equipmentNo}, ${h.tag}`} />
                  </td>
                  <td className={TD}>
                    <span className="id-plate">{h.equipmentNo}</span>
                  </td>
                  <td className={TD}>{h.tag}</td>
                  <td className={TD}>
                    <span className="id-plate">{h.floc}</span>
                  </td>
                  <td className={TD}>{h.manufacturer}</td>
                  <td className={TD}>
                    <span className={`${pctTone(h.verifiedPct)} tabular-nums`}>{h.verifiedPct}% verified</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${TD} text-muted-foreground`}>
                  No heater here matches “{query}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The chosen heater, kept in view through Verify and Review. */
export function EquipmentSummary({ heater, siteLabel }: { heater: SampleHeater; siteLabel: string }) {
  const facts = [
    { label: 'Equipment no.', value: heater.equipmentNo, Icon: Hash },
    { label: 'Tag', value: heater.tag, Icon: Tag },
    { label: 'FLOC', value: heater.floc, Icon: MapPin },
    { label: 'Location', value: siteLabel, Icon: Building2 },
  ];

  return (
    <dl className="grid w-full gap-x-800 gap-y-300 text-200 sm:grid-cols-2 xl:grid-cols-4">
      {facts.map(({ label, value, Icon }) => (
        <div key={label} className="flex min-w-0 items-start gap-200">
          <Icon aria-hidden="true" className="mt-100 icon-size-200 shrink-0 text-brand-foreground" />
          <div className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-100 truncate font-medium" title={value}>{value}</dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
