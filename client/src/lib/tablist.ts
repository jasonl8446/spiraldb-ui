/**
 * The APG tabs keyboard model, as one pure unit (plan task 5.5 AC#8).
 *
 * `ObjectListPage`'s filter tabs and `QuestPreview`'s section tabs both claim
 * `role="tablist"`; the p5-05 audit measured that neither implemented the keyboard
 * behaviour that role implies — every tab was reachable with Tab, but Arrow/Home/End did
 * nothing (docs/evidence/phase-5/p5-05-d1-audit.md §7.4). Focus movement is the caller's
 * job (it owns the DOM ids); this decides *which* index a key means, so the rule lives in
 * one place and is unit-testable in node.
 *
 * Automatic activation (select on arrow) is what both callers already do on click, so the
 * same `setFilter`/`setTab` is reused rather than adding a second selection state.
 *
 * Returns `null` for every key that is not a tablist navigation key, so a caller can
 * `preventDefault()` only when it actually handled something.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
