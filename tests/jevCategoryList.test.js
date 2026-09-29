'use strict';

/**
 * User-owned AI categories: an ordered list of buckets the user creates, each
 * with a label, criteria text and a display ACTION (expand | collapse).
 * Posts get the bucket's tag, and are expanded/collapsed per that action.
 */

const FIXED_FIRST_LINE = 'Classify the quoted post into exactly one category.';

describe('jev categories — user-owned model', () => {
  beforeEach(() => {
    global.__LI.setCfg({ jevCategories: undefined, jevCategoryText: {} });
  });

  test('defaults to a single minimal bucket (no imposed wording)', () => {
    const cats = global.__LI.getJevCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats).toHaveLength(1);
    expect(cats[0].action).toBe('expand');
    expect(cats[0].criteria).toBe('');
    expect(cats[0].id).toBe('relevant');
  });

  test('normalizes: unique ids, valid actions, strings, capped length', () => {
    const norm = global.__LI.normalizeJevCategories([
      { id: 'java', label: 'java', criteria: 'Java posts', action: 'collapse' },
      { id: 'java', label: 'dup', criteria: 'x', action: 'bogus' },
      { label: 'no id' },
      'junk',
      null,
    ]);
    const ids = norm.map(c => c.id);
    expect(ids).toEqual([...new Set(ids)]); // unique
    expect(norm[0].action).toBe('collapse');
    expect(norm[1].action).toBe('expand'); // invalid action → default
    expect(norm.every(c => typeof c.label === 'string' && typeof c.criteria === 'string')).toBe(true);
    expect(global.__LI.normalizeJevCategories(new Array(50).fill(null).map((_, i) => ({ id: 'c' + i }))).length)
      .toBeLessThanOrEqual(global.__LI.JEV_MAX_CATEGORIES);
  });

  test('add / update / remove / move', () => {
    global.__LI.addJevCategory({ id: 'java', label: 'java' });
    global.__LI.addJevCategory({ id: 'unsure-ish', label: 'unsure', action: 'collapse' });
    expect(global.__LI.getJevCategories().map(c => c.id)).toEqual(['relevant', 'java', 'unsure-ish']);

    global.__LI.updateJevCategory('java', { criteria: 'Java-heavy posts', action: 'collapse' });
    const java = global.__LI.getJevCategories().find(c => c.id === 'java');
    expect(java.criteria).toBe('Java-heavy posts');
    expect(java.action).toBe('collapse');

    global.__LI.moveJevCategory('unsure-ish', -1);
    expect(global.__LI.getJevCategories().map(c => c.id)).toEqual(['relevant', 'unsure-ish', 'java']);

    global.__LI.removeJevCategory('java');
    expect(global.__LI.getJevCategories().map(c => c.id)).toEqual(['relevant', 'unsure-ish']);
  });

  test('labels drop colons and newlines (bullet stays unambiguous)', () => {
    const norm = global.__LI.normalizeJevCategories([{ id: 'x', label: 'java: senior\nengineer', criteria: '', action: 'expand' }]);
    expect(norm[0].label).toBe('java senior engineer');
  });

  test('unknown ids are no-ops; last bucket cannot be removed', () => {
    expect(global.__LI.updateJevCategory('nope', { label: 'x' })).toBe(false);
    expect(global.__LI.removeJevCategory('nope')).toBe(false);
    global.__LI.removeJevCategory('relevant');
    expect(global.__LI.getJevCategories()).toHaveLength(1); // never zero
  });

  test('prompt uses the user buckets, their order, and a fixed skeleton', () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: 'React roles, my cities', action: 'expand' },
      { id: 'meh', label: 'mildly matching', criteria: 'adjacent stacks', action: 'collapse' },
      { id: 'no', label: 'java', criteria: '', action: 'collapse' },
    ]);
    const p = global.__LI.getEffectiveJevPrompt();
    expect(p.startsWith(FIXED_FIRST_LINE)).toBe(true);
    expect(p).toMatch(/- relevant: React roles, my cities/);
    expect(p).toMatch(/- java:/);
    // order follows the user's list
    expect(p.indexOf('- relevant:')).toBeLessThan(p.indexOf('- mildly matching:'));
    expect(p.indexOf('- mildly matching:')).toBeLessThan(p.indexOf('- java:'));
    // no hard-coded other/excluded words leak in
    expect(p).not.toMatch(/-\s*excluded:/);
    expect(p).not.toMatch(/-\s*other:/);
  });

  test('criteria map sent to providers keys by id with label+criteria', () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: 'React roles', action: 'expand' },
      { id: 'no', label: 'java', criteria: 'Java posts', action: 'collapse' },
    ]);
    const map = global.__LI.buildJevCategories();
    expect(Object.keys(map)).toEqual(['yes', 'no']);
    expect(map.yes).toMatch(/relevant/);
    expect(map.yes).toMatch(/React roles/);
    expect(map.no).toMatch(/Java posts/);
  });

  test('visibility follows the per-bucket action (and the peek switch)', () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: '', action: 'expand' },
      { id: 'meh', label: 'mildly matching', criteria: '', action: 'collapse' },
    ]);
    const keep = document.createElement('div');
    const hide = document.createElement('div');
    document.body.appendChild(keep);
    document.body.appendChild(hide);
    keep.setAttribute('data-jev-done', 'yes');
    keep.setAttribute('data-jev-cat', 'yes');
    hide.setAttribute('data-jev-done', 'meh');
    hide.setAttribute('data-jev-cat', 'meh');
    global.__LI.applyJevVisibilityAll();
    expect(keep.classList.contains('li-ac-jev-concealed')).toBe(false);
    expect(hide.classList.contains('li-ac-jev-concealed')).toBe(true);
    expect(global.__LI.jevConcealedCount()).toBe(1);
  });

  test('resolveJevCategory accepts only known bucket ids', () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: '', action: 'expand' },
    ]);
    const map = global.__LI.buildJevCategories();
    expect(global.__LI.resolveJevCategory({ choice: 'yes', confidence: 0.9 }, map, 0.7))
      .toEqual({ cat: 'yes', conf: 0.9 });
    expect(global.__LI.resolveJevCategory({ choice: 'nope', confidence: 0.9 }, map, 0.7).cat).toBe('unsure');
    expect(global.__LI.resolveJevCategory({ choice: 'yes', confidence: 0.2 }, map, 0.7).cat).toBe('unsure');
  });

  test('splits a legacy whole-prompt blob into a starter list', () => {
    const blob = 'Classify the quoted post into exactly one category.\n\n- relevant: R part\n- excluded: E part\n- other: O part\n\nWhen unsure between relevant and excluded, choose excluded.';
    expect(global.__LI.looksLikeLegacyPrompt(blob)).toBe(true);
    const cells = global.__LI.parseLegacyPromptCells(blob);
    expect(cells.relevant).toBe('R part');
    expect(cells.excluded).toBe('E part');
    expect(cells.other).toBe('O part');
    expect(global.__LI.looksLikeLegacyPrompt('just a sentence')).toBe(false);
  });

  test('migrates the old fixed model (relevant/excluded/other) once', () => {
    const migrated = global.__LI.migrateLegacyCategories(undefined, {
      relevant: 'React roles', excluded: 'Java posts', other: 'Anything else',
    });
    expect(migrated.map(c => c.label)).toEqual(['relevant', 'excluded', 'other']);
    expect(migrated[0].action).toBe('expand');
    expect(migrated[1].action).toBe('collapse');
    expect(migrated[0].criteria).toBe('React roles');
  });
});
