import type { ObjectTypeConfig } from './objectTypes.js';

/**
 * The `POST /api/<type>` **body** of the two write paths — one home, because the envelope's third
 * field is where p4-02 shipped a real defect (D76a).
 *
 * `server/src/services/objects.ts` accepts `{ object, notes?, key? }`:
 *
 * - `object` is the document;
 * - `key` is **the route key the client opened**, which the DropTable duplicate rule forgives
 *   (`Name` is both the key and the checked field — D70b). `ObjectDetailPage` never sent it until
 *   p4-08, so an **unmodified save of an existing drop table answered 400 against itself**, and
 *   nothing caught it because every tier-1 spec mocks the POST and the route tests supplied `key`
 *   themselves. The rule D76a records: at least one arm per write AC must drive the client's own
 *   body through the real route — which needs the body to *have* one home rather than living
 *   inline in a component's `mutationFn`;
 * - the **unkeyed** family (GlobalRegistry) rejects a supplied `key` outright
 *   (`server/src/services/objects.ts`), so its update envelope is the document alone.
 *
 * ## Two functions, because a create and an update are not the same request
 *
 * {@link updateObjectBody} answers "save this entry I opened" and carries its identity.
 * {@link createObjectBody} answers "create a new entry" and carries **no** `key`: there is no
 * entry being forgiven, so a name the corpus already holds must still hit the server's duplicate
 * rule rather than silently being treated as the entry's own identity.
 *
 * Pure and dependency-free, so the same two functions are used by the pages, the tier-1 specs and
 * the live rig — the point of one home.
 */

/** The documented request body of `POST /api/<type>` (spec-silent; fixed in `routes/objects.ts`). */
export interface ObjectSaveEnvelope {
  object: Record<string, unknown>;
  /** Present only for the update path of a keyed family. */
  key?: string;
  notes?: string;
}

/**
 * The update envelope: the live document plus the entry's own route key.
 *
 * The key is omitted for a family with no key field (`keyField === null`), whose POST refuses one.
 * `notes` is passed through when present (a `''` note is omitted rather than sent as `''`).
 */
export function updateObjectBody(
  config: ObjectTypeConfig,
  key: string,
  document: Record<string, unknown>,
  notes?: string,
): ObjectSaveEnvelope {
  const envelope: ObjectSaveEnvelope = { object: document };
  if (config.keyField !== null) {
    envelope.key = key;
  }
  if (notes !== undefined && notes !== '') {
    envelope.notes = notes;
  }
  return envelope;
}

/**
 * The create envelope: the document alone.
 *
 * No `key`, deliberately (see the module doc-comment). `notes` is omitted when blank.
 */
export function createObjectBody(
  document: Record<string, unknown>,
  notes?: string,
): ObjectSaveEnvelope {
  const envelope: ObjectSaveEnvelope = { object: document };
  if (notes !== undefined && notes !== '') {
    envelope.notes = notes;
  }
  return envelope;
}
