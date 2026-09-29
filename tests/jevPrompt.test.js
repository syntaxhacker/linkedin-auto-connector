'use strict';

/**
 * Jev panel UI — per-category VALUE cells on a FIXED skeleton.
 * (Pure model behavior lives in tests/jevCategories.test.js.)
 */

const { makePost, sendMessage, closePanels } = require('./helpers');

describe('jev prompt builder (compat surface)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevCategoryText: {}, jevPrompt: '' });
  });

  test('categories are standalone (keyword lists do not shape them)', () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'senior'], excludeKeywords: ['intern'] });
    const cats = global.__LI.buildJevCategories();
    expect(Object.keys(cats).sort()).toEqual(['excluded', 'other', 'relevant']);
    expect(cats.relevant).not.toMatch(/react/i);
    expect(cats.excluded).not.toMatch(/intern/i);
  });

  test('effective prompt keeps the fixed skeleton and reflects a cell override', () => {
    global.__LI.setCfg({ jevCategoryText: { relevant: 'fintech only' } });
    const prompt = global.__LI.getEffectiveJevPrompt();
    expect(prompt.startsWith(global.__LI.JEV_PROMPT_FIRST_LINE)).toBe(true);
    expect(prompt).toContain(global.__LI.JEV_PROMPT_TIE_BREAK);
    expect(prompt).toContain('fintech only');
  });
});

describe('jev category cells (manual + autofill)', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevCategoryText: {}, llmMinRunGapMs: 0 });
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
  const cell = k => document.querySelector('#li-ac-jev-cell-' + k);
  const preview = () => document.querySelector('#li-ac-jev-prompt-preview');
  const saved = () => document.querySelector('#li-ac-jev-saved');

  test('three fixed cells render and the preview shows the fixed skeleton', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    await openPanel();
    expect(cell('relevant')).not.toBeNull();
    expect(cell('excluded')).not.toBeNull();
    expect(cell('other')).not.toBeNull();
    expect(document.querySelector('#li-ac-jev-prompt')).toBeNull(); // old textarea gone
    expect(preview().textContent.startsWith(global.__LI.JEV_PROMPT_FIRST_LINE)).toBe(true);
    expect(preview().textContent).toContain(global.__LI.JEV_PROMPT_TIE_BREAK);
  });

  test('cells show the standalone defaults', async () => {
    await openPanel();
    expect(cell('relevant').value).toMatch(/hiring|role/i);
    expect(cell('other').value).toMatch(/anything else/i);
  });

  test('editing a cell saves it and the preview follows', async () => {
    await openPanel();
    cell('relevant').value = 'ONLY fintech hiring posts';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBe('ONLY fintech hiring posts');
    expect(preview().textContent).toContain('ONLY fintech hiring posts');
    expect(preview().textContent.startsWith(global.__LI.JEV_PROMPT_FIRST_LINE)).toBe(true);
    expect(saved().textContent).toMatch(/saved/i);
  });

  test('clearing a cell restores the default', async () => {
    await openPanel();
    cell('relevant').value = 'temp override';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    cell('relevant').value = '';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBeUndefined();
    expect(cell('relevant').value).toMatch(/hiring|role/i);
  });

  test('reset clears overrides back to defaults', async () => {
    global.__LI.setCfg({ jevCategoryText: { relevant: 'custom' } });
    await openPanel();
    document.querySelector('#li-ac-jev-prompt-reset').click();
    expect(global.__LI.getCfg().jevCategoryText).toEqual({});
    expect(cell('relevant').value).toMatch(/hiring|role/i);
    expect(saved().textContent).toMatch(/default/i);
  });

  test('min-confidence input clamps to 0..1, empty means default', async () => {
    await openPanel();
    const mc = document.querySelector('#li-ac-jev-minconf');
    mc.value = '2.5';
    mc.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevMinConfidence).toBe(1);
    mc.value = '';
    mc.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevMinConfidence).toBe(0.7);
  });
});

describe('jev panel wiring', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({
      includeKeywords: [], excludeKeywords: [], jevCategoryText: {}, jevFollowKeywords: false,
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

  test('invalid endpoint reverts with a status message', async () => {
    await openPanel();
    const ep = document.querySelector('#li-ac-llm-endpoint');
    ep.value = 'http://evil.local/x';
    ep.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ep.value).toBe('');
    expect(document.querySelector('#li-ac-jev-status').textContent).toMatch(/https/i);
    expect(global.__LI.getCfg().llmEndpoints).toEqual({});
  });

  test('switching provider refreshes endpoint, model, and key help', async () => {
    await openPanel();
    const sel = document.querySelector('#li-ac-llm-provider');
    sel.value = 'openai-compat';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().llmProviderId).toBe('openai-compat');
    expect(document.querySelector('#li-ac-jev-key-help').textContent).toMatch(/provider dashboard/i);
    expect(document.querySelector('#li-ac-llm-endpoint').placeholder).toMatch(/api.openai.com/);
  });

  test('key save blanks the field; clear removes the key', async () => {
    await openPanel();
    const key = document.querySelector('#li-ac-jev-key');
    key.value = 'not-a-real-key';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getLlmKey('jev')).toBe('not-a-real-key');
    expect(key.value).toBe('');
    expect(key.placeholder).toMatch(/saved/);
    document.querySelector('#li-ac-jev-key-clear').click();
    expect(global.__LI.getLlmKey('jev')).toBe('');
    expect(key.placeholder).toMatch(/paste key/);
  });

  test('storage changes reflect onto minconf and category cells', async () => {
    await openPanel();
    global.__onChanged({ jevMinConfidence: { newValue: 0.42 } }, 'sync');
    expect(document.querySelector('#li-ac-jev-minconf').value).toBe('0.42');
    global.__onChanged({ jevCategoryText: { newValue: { relevant: 'from storage' } } }, 'sync');
    expect(document.querySelector('#li-ac-jev-cell-relevant').value).toBe('from storage');
  });
});
