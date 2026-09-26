import { OVERWRITE_HEADING } from '../../lib/extract';

/**
 * The existing-name list of the overwrite confirmation (plan §2.4's last bullet,
 * gap A of story p2-07).
 *
 * Rendered inside the Save All confirm dialog **next to** the fixed confirmation
 * sentence, never instead of it: `Save {N} quests to SpiralDB? This will create
 * files and auto-commit.` is a hard copy requirement, and this is the extra
 * information the AC adds to it. It renders nothing for an empty list, so a save
 * that overwrites nothing looks exactly as it did before.
 *
 * The `<ul>` carries an accessible name so the spec can assert the listed names
 * (and, just as importantly, that a brand-new quest's name is *absent*).
 */
export interface ExistingQuestsNoticeProps {
  /** The quest names that already exist in SpiralDB, in extraction order. */
  names: string[];
}

export default function ExistingQuestsNotice({
  names,
}: ExistingQuestsNoticeProps): JSX.Element | null {
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm font-medium text-amber-300">{OVERWRITE_HEADING}</p>
      <ul
        aria-label="Quests that will be overwritten"
        className="mt-1 list-disc pl-5 font-mono text-sm text-amber-200"
      >
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
