import { useState } from 'react';

import FriendlyNameDropdown from './FriendlyNameDropdown';
import StatusBadge from './StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { NamesType } from '../lib/display';
import type { StatusValue } from '../lib/api';

/**
 * Shared-components smoke surface (story p1-10; plan task 1.8).
 *
 * The two components every later phase's editors depend on —
 * `FriendlyNameDropdown` and `StatusBadge` — would otherwise be unreachable until
 * Phase 2/4, and the plan's verification step asks for a "dropdown smoke test on a
 * stub page". This panel is that surface: real synced names from
 * `/api/names/:type`, the raw id shown next to each dropdown (proof that the
 * hidden field holds the id, not the label), and all three status badges.
 *
 * It is deliberately minimal and labelled as a verification surface rather than a
 * feature: the editors that consume these components arrive in Phases 2-4.
 */
const PREVIEW_TYPES: readonly NamesType[] = ['items', 'spells', 'npcs'];

const PREVIEW_STATUSES: readonly StatusValue[] = ['extracted', 'reviewed', 'verified'];

export default function SharedComponentsPreview(): JSX.Element {
  const [values, setValues] = useState<Partial<Record<NamesType, string>>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared components — smoke test</CardTitle>
        <CardDescription>
          FriendlyNameDropdown and StatusBadge against the real synced data. Each dropdown submits
          the raw id in a hidden field, exactly as the editors will.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-4">
        {PREVIEW_TYPES.map((type) => (
          <div key={type} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-300">{type}</span>
            <FriendlyNameDropdown
              type={type}
              value={values[type] ?? ''}
              onChange={(rawId) => setValues((previous) => ({ ...previous, [type]: rawId }))}
              name={`preview_${type}`}
              allowEmpty
              aria-label={`Preview ${type} friendly name dropdown`}
              placeholder={`Search ${type}…`}
            />
            <p className="font-mono text-xs text-zinc-500">
              raw id: {values[type] === undefined || values[type] === '' ? '(none)' : values[type]}
            </p>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 pt-4">
          <span className="text-sm text-zinc-400">StatusBadge:</span>
          {PREVIEW_STATUSES.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
