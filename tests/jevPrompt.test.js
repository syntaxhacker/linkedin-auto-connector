'use strict';

/**
 * Jev prompt builder — categories and instructions are auto-derived from the
 * user's include/exclude keywords; a custom textarea value overrides them.
 */

const { makePost, sendMessage, closePanels } = require('./helpers');

describe('jev prompt builder', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevPrompt: '' });
  });

  test('builds relevant/excluded/other categories from include/exclude keywords', () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'senior'], excludeKeywords: ['intern'] });
    const cats = global.__LI.buildJevCategories();
    expect(Object.keys(cats).sort()).toEqual(['excluded', 'other', 'relevant']);
    expect(cats.relevant).toMatch(/react/i);
    expect(cats.relevant).toMatch(/senior/i);
    expect(cats.excluded).toMatch(/intern/i);
    expect(typeof cats.other).toBe('string');
  });

  test('falls back to generic hiring-post wording with no include keywords', () => {
    const cats = global.__LI.buildJevCategories();
    expect(cats.relevant).toMatch(/hiring|job/i);
  });

  test('effective prompt contains the generated categories by default', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    const prompt = global.__LI.getEffectiveJevPrompt();
    expect(prompt).toMatch(/react/i);
    expect(prompt).toMatch(/intern/i);
  });

  test('custom textarea value overrides the generated prompt', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevPrompt: 'Custom: only fintech posts.' });
    expect(global.__LI.getEffectiveJevPrompt()).toBe('Custom: only fintech posts.');
  });

  test('blank custom prompt falls back to generated prompt', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevPrompt: '   ' });
    expect(global.__LI.getEffectiveJevPrompt()).toMatch(/react/i);
  });
});

describe('jev prompt textarea refresh', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevPrompt: '' });
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
  const promptBox = () => document.querySelector('#li-ac-jev-prompt');

  test('textarea starts empty (auto mode), effective prompt still generated', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    await openPanel();
    expect(promptBox().value).toBe('');
    expect(global.__LI.getEffectiveJevPrompt()).toMatch(/react/i);
  });

  test('autofill fills from keywords, saves, and confirms', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    await openPanel();
    document.querySelector('#li-ac-jev-autofill').click();
    expect(promptBox().value).toMatch(/react/i);
    expect(promptBox().value).toMatch(/intern/i);
    expect(global.__LI.getCfg().jevPrompt).toBe(promptBox().value);
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/autofilled \+ saved/i);
  });

  test('typing custom text saves with confirmation', async () => {
    await openPanel();
    promptBox().value = 'Custom: only fintech posts.';
    promptBox().dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevPrompt).toBe('Custom: only fintech posts.');
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/saved/i);
  });

  test('clearing shows auto-mode confirmation', async () => {
    global.__LI.setCfg({ jevPrompt: 'Custom text' });
    await openPanel();
    expect(promptBox().value).toBe('Custom text');
    promptBox().value = '';
    promptBox().dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevPrompt).toBe('');
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/auto mode/i);
  });

  test('keyword changes never rewrite the textarea', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    await openPanel();
    expect(promptBox().value).toBe('');
    global.__LI.removeKeyword('python', 'include');
    expect(promptBox().value).toBe('');
    document.querySelector('#li-ac-jev-autofill').click();
    expect(promptBox().value).toMatch(/react/i);
    global.__LI.removeKeyword('react', 'include');
    // autofilled text is saved text — stays until the user changes it
    expect(promptBox().value).toMatch(/react/i);
  });

  test('reset clears to auto mode with confirmation', async () => {
    global.__LI.setCfg({ jevPrompt: 'Custom text' });
    await openPanel();
    document.querySelector('#li-ac-jev-prompt-reset').click();
    expect(promptBox().value).toBe('');
    expect(global.__LI.getCfg().jevPrompt).toBe('');
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/auto mode/i);
  });

  test('min-confidence input clamps to 0..1, empty means default', async () => {
    await openPanel();
    const mc = document.querySelector('#li-ac-jev-minconf');
    expect(mc).not.toBeNull();
    mc.value = '2.5';
    mc.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevMinConfidence).toBe(1);
    mc.value = '';
    mc.dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevMinConfidence).toBe(0.7);
  });

  test('toggling jev mode off removes chips and marks', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevMode: true, llmMinRunGapMs: 0 });
    global.__LI.setJevApiKey('test-key-123');
    await openPanel();
    const post = makePost('React hiring post with body text here');
    const realFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    try {
      await global.__LI.llmClassifyPosts([post]);
      expect(post.querySelector('.li-ac-jev-chip')).not.toBeNull();
      const toggle = document.querySelector('#li-ac-jev-mode');
      expect(toggle.checked).toBe(true);
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
      expect(post.hasAttribute('data-jev-done')).toBe(false);
    } finally {
      global.fetch = realFetch;
      global.__LI.setJevApiKey('');
    }
    global.__LI.cleanup();
  });

  test('entering jev mode restores hidden posts for categorization', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevMode: true });
    global.__LI.setJevApiKey('test-key-123');
    jest.useFakeTimers();
    const hidden = makePost('React hidden post with body text here');
    hidden.classList.add('li-ac-hidden');
    const visible = makePost('React visible post with body text here');
    const realFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ answers: {
        c0: { choice: 'relevant', confidence: 0.9, probabilities: {} },
        c1: { choice: 'other', confidence: 0.8, probabilities: {} },
      } }),
    }));
    try {
      sendMessage({ type: 'FEED_SCAN' });
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      expect(hidden.classList.contains('li-ac-hidden')).toBe(false);
      expect(hidden.querySelector('.li-ac-jev-chip')).not.toBeNull();
      expect(visible.querySelector('.li-ac-jev-chip')).not.toBeNull();
    } finally {
      global.fetch = realFetch;
      global.__LI.setJevApiKey('');
    }
    global.__LI.cleanup();
  });
});

describe('jev follow-keywords mode', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], jevPrompt: '', jevFollowKeywords: false, llmMinRunGapMs: 0 });
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
  const promptBox = () => document.querySelector('#li-ac-jev-prompt');
  const followBox = () => document.querySelector('#li-ac-jev-follow');

  test('off by default: keyword changes leave the textarea alone', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    await openPanel();
    expect(followBox().checked).toBe(false);
    global.__LI.removeKeyword('python', 'include');
    expect(promptBox().value).toBe('');
  });

  test('enabling follow syncs immediately and follows keyword changes', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });
    await openPanel();
    followBox().checked = true;
    followBox().dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevFollowKeywords).toBe(true);
    expect(promptBox().value).toMatch(/python/i);
    expect(document.querySelector('#li-ac-jev-saved').textContent).toMatch(/synced/i);
    global.__LI.removeKeyword('python', 'include');
    expect(promptBox().value).not.toMatch(/python/i);
    expect(promptBox().value).toMatch(/react/i);
    expect(global.__LI.getCfg().jevPrompt).toBe(promptBox().value);
  });

  test('typing custom text disables follow mode', async () => {
    global.__LI.setCfg({ includeKeywords: ['react'], jevFollowKeywords: true });
    await openPanel();
    expect(followBox().checked).toBe(true);
    promptBox().value = 'Custom: only fintech posts.';
    promptBox().dispatchEvent(new Event('change', { bubbles: true }));
    expect(global.__LI.getCfg().jevFollowKeywords).toBe(false);
    expect(followBox().checked).toBe(false);
    expect(global.__LI.getCfg().jevPrompt).toBe('Custom: only fintech posts.');
  });

  test('focused draft is not clobbered even with follow on', async () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'], jevFollowKeywords: true });
    await openPanel();
    promptBox().focus();
    promptBox().value = 'Uncommitted draft edit';
    global.__LI.removeKeyword('python', 'include');
    expect(promptBox().value).toBe('Uncommitted draft edit');
  });
});

describe('jev panel wiring', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.cleanup();
    document.body.innerHTML = '';
    global.__LI.setCfg({
      includeKeywords: [], excludeKeywords: [], jevPrompt: '', jevFollowKeywords: false,
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
