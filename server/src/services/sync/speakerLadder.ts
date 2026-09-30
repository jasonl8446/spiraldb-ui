import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Db } from '../../db.js';
import {
  countSpeakerFallThroughs,
  readEvidenceTables,
  type SpeakerLadderCounts,
} from '../questEvidence.js';
import { parseJsonLenient } from './json.js';

/**
 * The speaker ladder's fall-through counts over the whole quest corpus (D124, task 7.14),
 * measured after the sync has written the tables the ladder reads (`string_table`,
 * `persona_index`, `npcs`) so the numbers describe the database the app will serve.
 */
export interface SpeakerLadderReport extends SpeakerLadderCounts {
  /** The corpus the counts belong to (always named — the phase's rule for two corpora). */
  corpus: string;
  /** Quest files parsed. */
  files: number;
  /** Quest files that could not be read or parsed (their rows are absent from `lines`). */
  unreadable: number;
}

export async function measureSpeakerLadder(
  db: Db,
  corpusPath: string,
): Promise<SpeakerLadderReport> {
  const dir = path.join(corpusPath, 'QuestTemplates');
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    // An absent directory measures as an empty corpus; the corpus stage already reports it.
  }
  const documents: unknown[] = [];
  let unreadable = 0;
  for (const name of names) {
    try {
      documents.push(parseJsonLenient(await readFile(path.join(dir, name), 'utf8')));
    } catch {
      unreadable += 1;
    }
  }
  const counts = countSpeakerFallThroughs(documents, readEvidenceTables(db));
  return { corpus: corpusPath, files: documents.length, unreadable, ...counts };
}
