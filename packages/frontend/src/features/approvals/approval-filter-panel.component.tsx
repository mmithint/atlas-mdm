import { button } from '@/components/ui';
import type { FacetOption } from '@/features/equipment/facets';
import { FacetSection, PanelShell } from '@/features/equipment/filter-panel.component';

import type { QueueFacet } from './queue-api';
import { AGE_OPTIONS, filterCount, tabById, withoutFilters, type QueueCriteria } from './queue-model';

const AGE_NOT_APPLICABLE = 'The age filter applies to open requests only. An approved or rejected request is closed, so it has no age.';

/** The three lists: which facet of the answer, and how the chosen value sits in the criteria. */
const SECTIONS: readonly { kind: string; id: string; label: string; value: (c: QueueCriteria) => string; set: (c: QueueCriteria, v: string) => QueueCriteria }[] = [
  { kind: 'PROFIT_CENTER', id: 'profitCenter', label: 'Profit centre', value: (c) => c.profitCenter, set: (c, v) => ({ ...c, profitCenter: v }) },
  { kind: 'FIELD', id: 'fieldCode', label: 'Field', value: (c) => c.fieldCode, set: (c, v) => ({ ...c, fieldCode: v }) },
  { kind: 'RULE', id: 'ruleId', label: 'Rule', value: (c) => c.ruleId, set: (c, v) => ({ ...c, ruleId: v }) },
];

/** A list's checkboxes with their counts. A value in the address stays listed even when this tab has no such row. */
function optionsOf(facets: readonly QueueFacet[], kind: string, current: string): FacetOption[] {
  const options = facets
    .filter((f) => f.kind === kind)
    .map((f) => ({ value: f.value, label: f.label || f.value, count: f.n, checked: f.value === current }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: current, count: 0, checked: true });
  return options;
}

/**
 * The Filters panel of the Approvals screen, built like Equipment's: checkbox lists with counts (searchable when long),
 * the age choice, Clear all, and the same panel frame beside the list or over the page. The server filters by one value
 * per list, so ticking another value of a list replaces the first. Each change goes to the address at once.
 */
export function ApprovalFilterPanel({
  id,
  overlay,
  criteria,
  facets,
  onChange,
  onClose,
}: {
  id: string;
  overlay: boolean;
  criteria: QueueCriteria;
  facets: readonly QueueFacet[];
  onChange: (next: QueueCriteria) => void;
  onClose: () => void;
}) {
  const count = filterCount(criteria);
  const ageApplies = tabById(criteria.tab).ageApplies;
  return (
    <PanelShell
      id={id}
      overlay={overlay}
      count={count}
      onClear={() => onChange(withoutFilters(criteria))}
      onClose={onClose}
      footer={
        <>
          <p className="text-200 text-muted-foreground" aria-live="polite">
            {count === 0 ? 'Tick a value to filter the list.' : `${count} ${count === 1 ? 'filter' : 'filters'} applied. One value per list.`}
          </p>
          {overlay ? (
            <button type="button" className={button.primary} onClick={onClose}>
              Show requests
            </button>
          ) : null}
        </>
      }
    >
      {SECTIONS.map((s) => {
        const current = s.value(criteria);
        const options = optionsOf(facets, s.kind, current);
        return options.length === 0 ? null : (
          <FacetSection
            key={s.id}
            panelId={id}
            facet={{ id: s.id, label: s.label }}
            options={options}
            startOpen
            onToggle={(value) => onChange(s.set(criteria, value === current ? '' : value))}
            onClear={() => onChange(s.set(criteria, ''))}
          />
        );
      })}

      <fieldset disabled={!ageApplies} title={ageApplies ? undefined : AGE_NOT_APPLICABLE} className="border-b border-divider px-400 py-300 disabled:opacity-60">
        <legend className="float-left w-full text-300 font-medium">Pending since</legend>
        <div className="clear-both mt-200 space-y-100">
          {AGE_OPTIONS.map((o) => (
            <label key={o.hours} className="flex min-h-800 cursor-pointer items-center gap-200 text-300 has-[:disabled]:cursor-not-allowed">
              <input
                type="radio"
                name={`${id}-age`}
                checked={criteria.minAgeHours === o.hours}
                onChange={() => onChange({ ...criteria, minAgeHours: o.hours })}
                className="icon-size-200 accent-primary"
              />
              {o.label}
            </label>
          ))}
        </div>
        {ageApplies ? null : <p className="mt-200 text-200 text-muted-foreground">Only for requests that are still open.</p>}
      </fieldset>
    </PanelShell>
  );
}
