import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fieldTerm } from '@shared/glossary';

import TermLabel from '../../client/src/components/TermLabel';
import { namePairDistinct } from '../../client/src/lib/display';

/**
 * Story p7-09 (task 7.8) — `<TermLabel />` renders `Friendly (technical)` (D131), keeps the
 * technical half selectable in mono, wraps everything in `data-term` (the task 7.9 scanner's
 * exclusion), and collapses identical halves through `display.ts`'s rule (D135).
 */

const render = (term: Parameters<typeof TermLabel>[0]['term']): string =>
  renderToStaticMarkup(createElement(TermLabel, { term }));

describe('TermLabel', () => {
  it('renders the friendly label with the technical half in a selectable mono span', () => {
    const html = render({ field: 'm_questLevel' });
    expect(fieldTerm('m_questLevel')?.label).toBe('Quest level');
    expect(html).toBe(
      '<span data-term="m_questLevel">Quest level (<span class="select-text font-mono">m_questLevel</span>)</span>',
    );
  });

  it('wraps every rendering in an element carrying data-term', () => {
    for (const term of [
      { field: 'm_questLevel' },
      { type: 'ReqHasQuest' },
      { type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty' },
      { enum: 'GoalType', value: 'GOAL_TYPE_PERSONA' },
      { group: 'Camera' },
      { field: 'm_notInTheGlossary' },
    ]) {
      expect(render(term)).toMatch(/^<span data-term="[^"]+"/);
    }
  });

  it('renders a class and an enum literal as pairs', () => {
    expect(render({ type: 'ReqHasQuest' })).toContain('Requires quest (<span');
    expect(render({ type: 'ReqHasQuest' })).toContain('>ReqHasQuest</span>)');
    expect(render({ enum: 'GoalType', value: 'GOAL_TYPE_PERSONA' })).toContain('Persona (<span');
    // The assembly-qualified `$type` shows its short class name as the technical half.
    expect(
      render({ type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty' }),
    ).toContain('>ReqHasQuest</span>)');
  });

  it('collapses a pair whose halves are identical to one value (D135)', () => {
    // `Fire` is both the friendly and the technical half of the MagicSchool literal.
    const html = render({ enum: 'MagicSchool', value: 'Fire' });
    expect(html).toBe('<span data-term="Fire"><span class="select-text">Fire</span></span>');
    expect(html).not.toContain('Fire (');
    // The same guard as the value pair's: the decision is `namePairDistinct`'s, not a copy of it.
    expect(namePairDistinct('Fire', 'Fire')).toBe('Fire');
    expect(namePairDistinct('Quest level', 'm_questLevel')).toBe('Quest level (m_questLevel)');
  });

  it('shows only the technical half, in mono, for a term with no entry (never a guess)', () => {
    expect(render({ field: 'm_notInTheGlossary' })).toBe(
      '<span data-term="m_notInTheGlossary"><span class="select-text font-mono">m_notInTheGlossary</span></span>',
    );
  });

  it('keeps a dialog section name as one value when its label is its own name', () => {
    expect(render({ group: 'Camera' })).toBe(
      '<span data-term="Camera"><span class="select-text">Camera</span></span>',
    );
  });
});
