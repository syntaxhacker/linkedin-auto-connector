'use strict';

/**
 * Jev panel UI — user-owned category editor (label + criteria + action).
 * The model itself is covered by tests/jevCategoryList.test.js.
 */

const { makePost, sendMessage, closePanels } = require('./helpers');

describe('jev panel wiring', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({
      includeKeywords: [], excludeKeywords: [], jevCategories: null, jevMode: false,
      llmProviderId: 'jev', llmEndpoints: {}, llmModels: {}, llmMinRunGapMs: 0,
    });
    global.__LI.resetLlmSession();
    global.__LI.resetLlmDaily();
  });

  afterEach(() => {
    jest.useRealTimers();
    closePanels();
  });

  async function openPanel() {
    jest.useFakeTimers();
    makePost('React hiring post with body text here');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(500);
  }
  const q = sel => document.querySelector(sel);
  const rows = () => document.querySelectorAll('#li-ac-jev-cat-editor [data-cat-row]');
  const preview = () => q('#li-ac-jev-prompt-preview');

  test('editor renders one row per category with label, criteria and action', async () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: 'React roles', action: 'expand' },
      { id: 'no', label: 'java', criteria: 'Java-heavy', action: 'collapse' },
    ]);
    await openPanel();
    expect(rows().length).toBe(2);
    expect(q('[data-cat-label="yes"]').value).toBe('relevant');
    expect(q('[data-cat-criteria="yes"]').value).toBe('React roles');
    expect(q('[data-cat-action="yes"]').value).toBe('expand');
    expect(q('[data-cat-action="no"]').value).toBe('collapse');
    // preview shows the user's buckets, not a fixed trio
    expect(preview().textContent).toContain('- relevant: React roles');
    expect(preview().textContent).toContain('- java: Java-heavy');
    expect(preview().textContent).not.toContain('- excluded:');
  });

  test('editing a criteria saves and refreshes the preview', async () => {
    await openPanel();
    const crit = q('[data-cat-criteria="relevant"]');
    crit.value = 'ONLY fintech React roles';
    crit.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getJevCategories()[0].criteria).toBe('ONLY fintech React roles');
    expect(preview().textContent).toContain('ONLY fintech React roles');
    expect(q('#li-ac-jev-saved').textContent).toMatch(/saved/i);
  });

  test('changing the action expands/collapses posts of that category', async () => {
    global.__LI.setJevCategories([
      { id: 'yes', label: 'relevant', criteria: '', action: 'expand' },
      { id: 'meh', label: 'mildly matching', criteria: '', action: 'collapse' },
    ]);
    await openPanel();
    const keep = makePost('kept post');
    const hide = makePost('hidden post');
    keep.setAttribute('data-jev-done', 'yes');
    hide.setAttribute('data-jev-done', 'meh');
    global.__LI.applyJevVisibilityAll();
    expect(hide.classList.contains('li-ac-jev-concealed')).toBe(true);

    const sel = q('[data-cat-action="meh"]');
    sel.value = 'expand';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getJevCategories().find(c => c.id === 'meh').action).toBe('expand');
    global.__LI.applyJevVisibilityAll();
    expect(hide.classList.contains('li-ac-jev-concealed')).toBe(false);
  });

  test('add / remove / reorder from the panel', async () => {
    await openPanel();
    q('#li-ac-jev-cat-add').click();
    expect(global.__LI.getJevCategories().length).toBe(2);
    expect(rows().length).toBe(2);

    const ids = global.__LI.getJevCategories().map(c => c.id);
    q('[data-cat-remove="' + ids[1] + '"]').click();
    expect(global.__LI.getJevCategories().length).toBe(1);

    // last one cannot be removed
    q('[data-cat-remove="' + global.__LI.getJevCategories()[0].id + '"]').click();
    expect(global.__LI.getJevCategories().length).toBe(1);
    expect(q('#li-ac-jev-saved').textContent).toMatch(/at least one/i);
  });

  test('reset returns to a single default category', async () => {
    global.__LI.setJevCategories([
      { id: 'a', label: 'a', criteria: 'x', action: 'collapse' },
      { id: 'b', label: 'b', criteria: 'y', action: 'expand' },
    ]);
    await openPanel();
    q('#li-ac-jev-prompt-reset').click();
    const cats = global.__LI.getJevCategories();
    expect(cats.length).toBe(1);
    expect(cats[0].action).toBe('expand');
  });

  test('storage changes re-render the editor', async () => {
    await openPanel();
    global.__onChanged({ jevCategories: { newValue: [{ id: 'z', label: 'zed', criteria: 'zz', action: 'collapse' }] } }, 'sync');
    expect(q('[data-cat-row="z"]')).not.toBeNull();
    expect(q('[data-cat-label="z"]').value).toBe('zed');
  });
});
