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

  test('builds relevant/excluded/other categories from include/exclude keywords', () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'senior'], excludeKeywords: ['intern'] });
    const cats = global.__LI.buildJevCategories();
    expect(Object.keys(cats).sort()).toEqual(['excluded', 'other', 'relevant']);
    expect(cats.relevant).toMatch(/react/i);
    expect(cats.relevant).toMatch(/senior/i);
    expect(cats.excluded).toMatch(/intern/i);
  });

  test('effective prompt keeps the fixed skeleton and reflects a cell override', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevCategoryText: { relevant: 'fintech only' } });
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

  test('keyword-derived values populate the cells by default', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    await openPanel();
    expect(cell('relevant').value).toMatch(/react/i);
    expect(cell('excluded').value).toMatch(/intern/i);
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

  test('clearing a cell restores the keyword default', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    await openPanel();
    cell('relevant').value = 'temp override';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    cell('relevant').value = '';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBeUndefined();
    expect(cell('relevant').value).toMatch(/react/i);
  });

  test('autofill fills relevant/excluded from keywords and saves', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    await openPanel();
    document.querySelector('#li-ac-jev-autofill').click();
    expect(global.__LI.getCfg().jevCategoryText.relevant).toMatch(/react/i);
    expect(global.__LI.getCfg().jevCategoryText.excluded).toMatch(/intern/i);
    expect(saved().textContent).toMatch(/autofilled/i);
  });

  test('reset clears overrides back to keyword defaults', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevCategoryText: { relevant: 'custom' } });
    await openPanel();
    document.querySelector('#li-ac-jev-prompt-reset').click();
    expect(global.__LI.getCfg().jevCategoryText).toEqual({});
    expect(cell('relevant').value).toMatch(/react/i);
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

describe('jev follow-keywords mode', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevCategoryText: {}, jevFollowKeywords: false, llmMinRunGapMs: 0 });
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
  const followBox = () => document.querySelector('#li-ac-jev-follow');

  test('off by default: keyword changes leave the cells at defaults', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    await openPanel();
    expect(followBox().checked).toBe(false);
    global.__LI.removeKeyword('python', 'include');
    expect(cell('relevant').value).toMatch(/react/i);
    expect(cell('relevant').value).not.toMatch(/python/i);
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBeUndefined();
  });

  test('enabling follow syncs relevant/excluded and tracks keyword changes', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    await openPanel();
    followBox().checked = true;
    followBox().dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevFollowKeywords).toBe(true);
    expect(cell('relevant').value).toMatch(/python/i);
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/synced/i);
    global.__LI.removeKeyword('python', 'include');
    expect(cell('relevant').value).not.toMatch(/python/i);
    expect(cell('relevant').value).toMatch(/react/i);
  });

  test('focused cell draft is not clobbered by a keyword sync', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'], jevFollowKeywords: true });
    await openPanel();
    cell('relevant').focus();
    cell('relevant').value = 'Uncommitted draft edit';
    global.__LI.removeKeyword('python', 'include');
    expect(cell('relevant').value).toBe('Uncommitted draft edit');
  });

  test('editing a cell disables follow mode', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevFollowKeywords: true });
    await openPanel();
    expect(followBox().checked).toBe(true);
    cell('relevant').value = 'Manual value';
    cell('relevant').dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevFollowKeywords).toBe(false);
    expect(followBox().checked).toBe(false);
    expect(global.__LI.getCfg().jevCategoryText.relevant).toBe('Manual value');
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

  test('storage changes reflect onto follow checkbox and minconf', async () => {
    await openPanel();
    global.__onChanged({ jevFollowKeywords: { newValue: true } }, 'sync');
    expect(document.querySelector('#li-ac-jev-follow').checked).toBe(true);
    global.__onChanged({ jevMinConfidence: { newValue: 0.42 } }, 'sync');
    expect(document.querySelector('#li-ac-jev-minconf').value).toBe('0.42');
  });
});
