import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { objectTypeConfig } from '@shared/objectTypes';
import { fileNamesForRegistryKeys, GLOBAL_REGISTRY_FILE_NAME } from '@shared/simpleObjects';

import GlobalRegistryForm from '../components/objects/GlobalRegistryForm';
import { listObjects, objectListQueryKey } from '../lib/objects';
import ObjectDetailPage from './ObjectDetailPage';

/**
 * The GlobalRegistry **editor** route — plan task 4.9 (story p4-07 AC1 + AC2), reached at
 * `/global-registry` exactly as docs/spec-api.md **L474** writes it: "GlobalRegistry editor".
 *
 * The spec gives this family no list route and no detail route, and that is right rather than an
 * omission: `GlobalRegistry/` is **one merged dictionary**, not a collection
 * (docs/spec-domain-reference.md L102-119, L711-712). So this single route renders
 * `ObjectDetailPage` — the generic chrome: header, Edit/Save, JSON panel, the document model —
 * with the family's own form, and the entry's key is the **convention file name** the save
 * writes rather than a URL segment (there is nothing to select).
 *
 * ## What the page contributes, and what it deliberately does not
 *
 * The **document** is the *merged* view: `GET /api/global-registry/:key` merges every
 * `GlobalRegistry/*.json` server-side (case-sensitive keys, later files win — the merge rule's
 * home is `shared/simpleObjects/globalRegistry.ts`), so this page passes it through untouched.
 * The page adds exactly three things:
 *
 * 1. the list query, whose `objects[]` rows are one per **file** for this unkeyed family, turned
 *    into file names by {@link fileNamesForRegistryKeys} — the pre-save disclosure's input, so
 *    the editor says which files a save replaces **before** it happens (D22's review surface);
 * 2. `unreadableFiles`, the list's `skipped[]` — a file the save will leave in place rather than
 *    delete, named so the user is not surprised by a directory that still holds more than one
 *    file;
 * 3. `editable`, because `ObjectDetailLayout` hides the Edit/Save pair for a family with no
 *    lifecycle badge. The registry has no `entry_status` row (Q1) but its document is exactly
 *    what task 4.9 edits, so the page states that rather than letting the layout guess from
 *    `status === null`.
 *
 * A failed or in-flight list renders no disclosure (never a guess); a failed **document** fetch
 * is the generic page's own three-state handling, unchanged.
 */
const GLOBAL_REGISTRY = objectTypeConfig('globalregistry');

export default function GlobalRegistryPage(): JSX.Element {
  const list = useQuery({
    queryKey: objectListQueryKey(GLOBAL_REGISTRY),
    queryFn: () => listObjects(GLOBAL_REGISTRY),
    // The corpus changes under the tool only when a save lands, and the save invalidates this
    // key; a failure must not break the editor, so no retry storm.
    staleTime: 30_000,
    retry: false,
  });

  const files = useMemo(
    () =>
      list.data === undefined
        ? undefined
        : fileNamesForRegistryKeys(list.data.objects.map((row) => row.key)),
    [list.data],
  );

  const unreadableFiles = useMemo(
    () => (list.data?.skipped ?? []).map((skipped) => skipped.file),
    [list.data],
  );

  return (
    <ObjectDetailPage
      config={GLOBAL_REGISTRY}
      // No URL key: the merged view is the whole family, and `globalregistry.json` is the file a
      // save writes. The read merges the directory for any key, so this is a name, not a lookup.
      objectKey={GLOBAL_REGISTRY_FILE_NAME}
      nounPlural="global registry"
      backLabel="Back to Global Registry"
      editable
      renderForm={({ document, mode, state }) => (
        <GlobalRegistryForm
          document={document}
          mode={mode}
          state={state}
          files={files}
          unreadableFiles={unreadableFiles}
        />
      )}
    />
  );
}
