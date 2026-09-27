import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import JSON5 from 'json5';

/**
 * Story p4-09 — the **tier-2 live rig** spec (D23 tier 2, D76a's strongest form).
 *
 * This is deliberately **not** part of the tier-1 suite: it drives the real, built client against a
 * real server writing the real D17 clone, so it needs a rig the operator started (it has no
 * `webServer`) and a clean clone. It is not collected by the default `npm run test:ui` run (the
 * file name is `*.rig.ts`, not `*.spec.ts`). Run it with its own config:
 *
 * ```
 * P4_09_LIVE_URL=http://localhost:3199 P4_09_CLONE=$PWD/data/test-spiraldb \
 *   npx playwright test --config tests/ui/p4-09-live.config.ts
 * ```
 *
 * Prerequisites (the operator's, exactly as the story's evidence records them): a fresh-port
 * server whose settings point at the clone, with `user_name` and `git_branch` seeded **before
 * boot** to the clone's real branch (D76(b)); the clone at `18dc924` on `content/2026-09-27`, clean,
 * with `NpcDropTable/` absent. Afterwards the operator restores the five axes.
 *
 * | test | AC | what it proves that a mocked tier-1 test cannot |
 * |---|---|---|
 * | update through the page | AC2 | the page's own Edit → Description → Save posts its own envelope through the real route and lands **one commit** on the file's ORIGINAL legacy path, on the **branch the settings name** (the D76(b) axis) |
 * | create through the dialog | AC3 | the `New NPC drop table` dialog creates the convention file, bootstraps the absent directory, and leaves an `extracted` row with the `Created via UI` note |
 */

const CLONE = process.env.P4_09_CLONE ?? path.join(process.cwd(), 'data', 'test-spiraldb');

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: CLONE, encoding: 'utf8' }).trim();
}

test.describe('p4-09 live rig — the built client against the real server and the real clone', () => {
  test('AC2: Edit → one field → Save commits the ORIGINAL legacy path on the settings branch', async ({
    page,
  }) => {
    const originalPath = 'DropTables/droptables_ds-acad-c01-001.json';
    const original = JSON5.parse(readFileSync(path.join(CLONE, originalPath), 'utf8')) as Record<
      string,
      unknown
    >;

    await page.goto('/drop-tables/DS-ACAD-C01-001');
    // The detail page resolved the route key to the entry (the header shows the key, not the file
    // name the legacy corpus uses).
    await expect(page.getByRole('main').getByText('DS-ACAD-C01-001')).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const description = page.getByLabel('Description');
    await expect(description).toHaveValue(String(original.Description ?? ''));
    await description.fill('p4-09 live rig edit');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // The page's own success toast carries the server's commit message.
    await expect(page.getByText('spiraldb: update drop_table DS-ACAD-C01-001')).toBeVisible();

    // From the clone: one commit, one path — the ORIGINAL legacy file, not a convention twin.
    expect(git(['log', '-1', '--format=%s'])).toBe('spiraldb: update drop_table DS-ACAD-C01-001');
    expect(git(['diff', '--no-renames', '--name-only', 'HEAD~1'])).toBe(originalPath);
    expect(git(['branch', '--show-current'])).toBe('content/2026-09-27');

    // The data diff is only the edited field (the rest of the document is byte-for-byte the same
    // after JSON5 parse: the first save also normalises this legacy file's formatting, which the
    // story's evidence names as the allowed one-time normalisation).
    const after = JSON5.parse(readFileSync(path.join(CLONE, originalPath), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(after.Description).toBe('p4-09 live rig edit');
    expect({ ...after, Description: original.Description }).toEqual(original);
  });

  test('AC3: `New NPC drop table` creates the convention file, the directory and the status row', async ({
    page,
  }) => {
    expect(existsSync(path.join(CLONE, 'NpcDropTable'))).toBe(false);

    await page.goto('/npc-drop-tables');
    await page.getByRole('button', { name: 'New NPC drop table', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('NPC TemplateID').fill('87113');
    await expect(dialog.getByText('Will create npcdroptable_87113.json')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByText('spiraldb: create npc_drop_table 87113')).toBeVisible();

    expect(git(['log', '-1', '--format=%s'])).toBe('spiraldb: create npc_drop_table 87113');
    expect(git(['diff', '--no-renames', '--name-only', 'HEAD~1'])).toBe(
      'NpcDropTable/npcdroptable_87113.json',
    );
    expect(existsSync(path.join(CLONE, 'NpcDropTable/npcdroptable_87113.json'))).toBe(true);
    expect(
      JSON5.parse(readFileSync(path.join(CLONE, 'NpcDropTable/npcdroptable_87113.json'), 'utf8')),
    ).toEqual({
      TemplateID: 87113,
      DropTableNames: [],
    });

    // AC3's status clause, read from the real routes.
    const status = (await (await page.request.get('/api/status/npc_drop_tables')).json()) as {
      entries: Array<{ object_key: string; status: string }>;
    };
    expect(status.entries.filter((row) => row.object_key === '87113')).toEqual([
      expect.objectContaining({ status: 'extracted' }),
    ]);
    const history = (await (
      await page.request.get('/api/status/npc_drop_tables/87113/history')
    ).json()) as { history: Array<{ notes: string | null; changed_by: string | null }> };
    expect(history.history.map((row) => row.notes)).toContain('Created via UI');
    expect(history.history[0]?.changed_by).toBe('p4-09 rig');
  });
});
