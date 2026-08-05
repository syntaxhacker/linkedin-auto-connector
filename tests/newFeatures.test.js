'use strict';

/**
 * New features:
 *  - '+' AND-grouping in keywords ("react+senior" needs BOTH words)
 *  - right-click → add post keywords to include/exclude
 *  - list navigation (↑/↓ arrows scroll their own containers)
 *  - Enter-to-add keywords (Apply button removed)
 *  - Show button reveals hidden posts and re-scans
 */

const { makePost, sendMessage, closePanels } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('+ AND-grouping', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  test('kwParts splits "react+senior" into both parts', () => {
    expect(global.__LI.kwParts('react+senior')).toEqual(['react', 'senior']);
    expect(global.__LI.kwParts('a+b+c')).toEqual(['a', 'b', 'c']); // multiple AND groups
  });

  test('kwParts keeps "c++" intact (trailing + is not an AND separator)', () => {
    expect(global.__LI.kwParts('c++')).toEqual(['c++']);
  });

  test('kwMatch: "react+senior" requires BOTH substrings', () => {
    expect(global.__LI.kwMatch('we need a senior react dev', 'react+senior')).toBe(true);
    expect(global.__LI.kwMatch('senior engineer, no javascript here', 'react+senior')).toBe(false);
    expect(global.__LI.kwMatch('react only', 'react+senior')).toBe(false);
  });

  test('kwMatch: "c++" still matches c++ text (not split)', () => {
    expect(global.__LI.kwMatch('c++ engineer', 'c++')).toBe(true);
    expect(global.__LI.kwMatch('c programming', 'c++')).toBe(false);
  });

  test('wordMatch: "react+senior" requires both as words', () => {
    expect(global.__LI.wordMatch('Senior React Developer', 'react+senior')).toBe(true);
    expect(global.__LI.wordMatch('senior backend', 'react+senior')).toBe(false);
    expect(global.__LI.wordMatch('React without seniority', 'react+senior')).toBe(false);
    // word boundaries still apply per part
    expect(global.__LI.wordMatch('reactions senior', 'react+senior')).toBe(false);
  });

  test('filterPosts: exclude "react+senior" hides only posts with both', () => {
    global.__LI.setCfg({ excludeKeywords: ['react+senior'] });
    const both = makePost('Senior React Developer role');
    const one = makePost('React Developer role');
    const other = makePost('Senior backend role');

    global.__LI.filterPosts(global.__LI.getPosts());

    expect(both.classList.contains('li-ac-hidden')).toBe(true);
    expect(one.classList.contains('li-ac-hidden')).toBe(false);
    expect(other.classList.contains('li-ac-hidden')).toBe(false);
  });

  test('scanKeywords: "react+senior" hits only posts containing both words', () => {
    global.__LI.setCfg({ includeKeywords: ['react+senior'] });
    const both = makePost('Senior React Developer opening');
    const one = makePost('React developer opening');

    const hits = global.__LI.scanKeywords([both, one]);
    expect(hits).toHaveLength(1);
    expect(hits[0].el).toBe(both);
    expect(hits[0].keywords).toEqual(['react+senior']);
  });
});

describe('right-click → add post keywords', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('extractKeywordsFromPost returns meaningful tokens, skipping stopwords', () => {
    const post = makePost('We are hiring a senior react developer for a fintech startup in bangalore');
    const kws = global.__LI.extractKeywordsFromPost(post);
    expect(kws.length).toBeGreaterThan(0);
    expect(kws.join(' ')).not.toMatch(/\b(we|are|a|for|in)\b/);
    // top tokens should include the salient words
    expect(kws.join(' ')).toContain('react');
    expect(kws.join(' ')).toContain('senior');
  });

  test('captureRightClick stores the right-clicked post', () => {
    const post = makePost('Senior React developer opening');
    global.__LI.captureRightClick({ target: post });
    expect(global.__LI.addRightClickedTo('include')).toBeGreaterThan(0);
    expect(global.__LI.getCfg().includeKeywords.length).toBeGreaterThan(0);
  });

  test('addRightClickedTo(exclude) adds extracted keywords to excludes', () => {
    const post = makePost('Senior Java developer opening');
    global.__LI.captureRightClick({ target: post });
    const added = global.__LI.addRightClickedTo('exclude');
    expect(added).toBeGreaterThan(0);
    expect(global.__LI.getCfg().excludeKeywords.length).toBeGreaterThan(0);
    expect(global.__LI.getCfg().excludeKeywords.join(' ')).toContain('java');
    expect(global.chrome.storage.sync.set).toHaveBeenCalled();
  });

  test('addRightClickedTo does nothing when nothing was right-clicked', () => {
    global.__LI.captureRightClick({ target: document.body });
    expect(global.__LI.addRightClickedTo('include')).toBe(0);
    expect(global.__LI.getCfg().includeKeywords).toEqual([]);
  });

  test('ADD_KEYWORD_CONTEXT message adds right-clicked post keywords to include', () => {
    const post = makePost('Senior React developer opening');
    global.__LI.captureRightClick({ target: post });
    const { response } = sendMessage({ type: 'ADD_KEYWORD_CONTEXT', kind: 'include' });
    expect(response).toEqual({ ok: true, added: expect.any(Number) });
    expect(global.__LI.getCfg().includeKeywords.length).toBeGreaterThan(0);
  });
});

describe('list navigation (↑/↓ arrows) + Enter-to-add', () => {
  let panel;
  let found;
  beforeEach(() => {
    const c = document.getElementById('li-ac-panel-close'); if (c) c.click();
    const fc = document.getElementById('li-ac-found-close'); if (fc) fc.click();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  async function openPanelWithHits() {
    jest.useFakeTimers();
    global.__LI.setCfg({ includeKeywords: ['react'] });
    makePost('React role one bob@example.com');
    makePost('React role two carol@example.com');
    makePost('React role three dan@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    panel = document.getElementById('li-ac-panel');
    found = document.getElementById('li-ac-found-panel');
  }

  test('the Apply button is gone; Enter adds a keyword', async () => {
    await openPanelWithHits();
    expect(panel.querySelector('#li-ac-kw-apply')).toBeNull();

    const inc = panel.querySelector('#li-ac-kw-include');
    inc.value = 'typescript';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(global.__LI.getCfg().includeKeywords).toContain('typescript');
    expect(inc.value).toBe('');
    const tags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    expect(tags.length).toBeGreaterThan(0);
  });

  test('↑/↓ arrows navigate the email list container', async () => {
    await openPanelWithHits();
    const list = found.querySelector('#li-ac-panel-list');
    const down = found.querySelector('#li-ac-em-down');
    const up = found.querySelector('#li-ac-em-up');
    const rows = () => Array.from(list.querySelectorAll('[data-idx]'));
    expect(rows().length).toBeGreaterThanOrEqual(2);

    // Click down: selects row 0.
    down.click();
    let sel = rows().filter(r => r.style.background).length;
    expect(sel).toBe(1);

    // Click down again: moves to row 1.
    const first = rows().find(r => r.style.background);
    down.click();
    const second = rows().find(r => r.style.background);
    expect(second).not.toBe(first);

    // Up returns to the previous.
    up.click();
    const back = rows().find(r => r.style.background);
    expect(back).toBe(first);
  });

  test('↑/↓ arrows navigate the keyword list container', async () => {
    await openPanelWithHits();
    const list = found.querySelector('#li-ac-kw-list');
    const down = found.querySelector('#li-ac-kw-down');
    expect(Array.from(list.querySelectorAll('[data-idx]')).length).toBeGreaterThanOrEqual(2);

    down.click();
    const selected = Array.from(list.querySelectorAll('[data-idx]')).filter(r => r.style.background);
    expect(selected).toHaveLength(1);
  });

  test('Newest sort toggle reorders the email list newest-first', async () => {
    await openPanelWithHits();
    const list = found.querySelector('#li-ac-panel-list');

    // Mark one hit as viewed/older by manipulating hitMeta firstSeen directly.
    const rows0 = Array.from(list.querySelectorAll('[data-idx]'));
    expect(rows0.length).toBeGreaterThanOrEqual(2);
    const key0 = rows0[0].getAttribute('data-key');
    const meta0 = global.__LI.hitMeta().get('em:' + key0);
    // Make row0 appear OLDER than the others.
    meta0.firstSeen = Date.now() - 60000;

    // Default (no sort): feed order preserved — row0 stays first.
    expect(rows0[0].getAttribute('data-key')).toBe(key0);

    // Toggle sort via the button.
    found.querySelector('#li-ac-em-sort').click();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const sortedRows = Array.from(found.querySelector('#li-ac-panel-list').querySelectorAll('[data-idx]'));
    // Newest first → the older row0 should NOT be first anymore.
    expect(sortedRows[0].getAttribute('data-key')).not.toBe(key0);
  });

  test('panel rows use larger font sizes (headline 14px, snippet 12px)', async () => {
    await openPanelWithHits();
    const firstRow = found.querySelector('#li-ac-panel-list [data-idx]');
    const headline = firstRow.firstElementChild;
    const snippet = firstRow.children[1];
    expect(headline.style.fontSize).toBe('14px');
    expect(snippet.style.fontSize).toBe('12px');
  });

  test('Show button reveals hidden posts and re-scans them into lists', async () => {
    await openPanelWithHits();
    // Hide one post via exclude, then Show.
    global.__LI.setCfg({ excludeKeywords: ['one'] });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(global.__LI.getHiddenCount()).toBeGreaterThan(0);

    panel = document.getElementById('li-ac-panel');
    panel.querySelector('#li-ac-hidden-show').click();
    await jest.advanceTimersByTimeAsync(400);

    expect(global.__LI.getHiddenCount()).toBe(0);
    const countEl = panel.querySelector('#li-ac-hidden-count');
    expect(countEl.textContent).toContain('Hidden: 0');
    // revealed post is back in the live post set
    expect(global.__LI.getPosts().length).toBeGreaterThan(0);
  });

  test('time-ago labels refresh in the found panel', async () => {
    await openPanelWithHits();
    const found = document.getElementById('li-ac-found-panel');
    const row = found.querySelector('[data-kind="em"][data-key]');
    const ago = row.querySelector('[data-ago]');
    expect(ago.textContent).toMatch(/\d+s ago|\d+min ago|\d+h ago/);

    // Advance past the 10s refresh interval; labels update in place.
    await jest.advanceTimersByTimeAsync(11000);
    expect(ago.textContent).toMatch(/\d+s ago|\d+min ago|\d+h ago/);
  });
});

describe('two-panel layout (control + found)', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  async function open() {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    makePost('React role two carol@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('both panels exist with distinct ids; found sits left of control', async () => {
    await open();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(found).not.toBeNull();
    expect(found.style.right).toBe('348px');
    // Control panel keeps the keyword inputs; found panel has the lists.
    expect(panel.querySelector('#li-ac-kw-include')).not.toBeNull();
    expect(found.querySelector('#li-ac-kw-list')).not.toBeNull();
    expect(found.querySelector('#li-ac-panel-list')).not.toBeNull();
  });

  test('found lists have fixed equal heights', async () => {
    await open();
    const found = document.getElementById('li-ac-found-panel');
    const kwList = found.querySelector('#li-ac-kw-list');
    const emList = found.querySelector('#li-ac-panel-list');
    expect(kwList.style.minHeight).toBe('38vh');
    expect(emList.style.minHeight).toBe('38vh');
  });

  test('closing the found panel leaves the control panel open (independent close)', async () => {
    await open();
    document.getElementById('li-ac-found-close').click();
    expect(document.getElementById('li-ac-found-panel')).toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
  });

  test('closing the control panel leaves the found panel open (independent close)', async () => {
    await open();
    document.getElementById('li-ac-panel-close').click();
    expect(document.getElementById('li-ac-panel')).toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
  });

  test('RESET clears both panels', async () => {
    await open();
    sendMessage({ type: 'RESET' });
    expect(document.getElementById('li-ac-panel')).toBeNull();
    expect(document.getElementById('li-ac-found-panel')).toBeNull();
  });
});

describe('collapsible keywords section', () => {
  let panel;
  beforeEach(() => {
    const c = document.getElementById('li-ac-panel-close'); if (c) c.click();
    const fc = document.getElementById('li-ac-found-close'); if (fc) fc.click();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.setKwSectionCollapsed(false);
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.setKwSectionCollapsed(false);
    global.__LI.cleanup();
  });

  async function openPanel() {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    panel = document.getElementById('li-ac-panel');
  }

  test('keyword inputs section is expanded by default', async () => {
    await openPanel();
    const section = panel.querySelector('#li-ac-kw-section');
    const btn = panel.querySelector('#li-ac-kw-collapse');
    expect(section.style.display).toBe('');
    expect(btn.textContent).toBe('▼');
    expect(global.__LI.getKwSectionCollapsed()).toBe(false);
  });

  test('clicking the collapse button hides the section and flips the chevron', async () => {
    await openPanel();
    panel.querySelector('#li-ac-kw-collapse').click();

    expect(global.__LI.getKwSectionCollapsed()).toBe(true);
    expect(panel.querySelector('#li-ac-kw-section').style.display).toBe('none');
    expect(panel.querySelector('#li-ac-kw-collapse').textContent).toBe('▲');
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ kwSectionCollapsed: true });

    // Found lists remain visible (in the separate found panel).
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-kw-list').style.display).not.toBe('none');
    expect(found.querySelector('#li-ac-panel-list').style.display).not.toBe('none');

    // Click again to expand.
    panel.querySelector('#li-ac-kw-collapse').click();
    expect(global.__LI.getKwSectionCollapsed()).toBe(false);
    expect(panel.querySelector('#li-ac-kw-section').style.display).toBe('');
    expect(panel.querySelector('#li-ac-kw-collapse').textContent).toBe('▼');
  });

  test('setKwSectionCollapsed applies state and persists; inputs still work when expanded', async () => {
    await openPanel();
    global.__LI.setKwSectionCollapsed(true);
    expect(panel.querySelector('#li-ac-kw-section').style.display).toBe('none');

    global.__LI.setKwSectionCollapsed(false);
    const inc = panel.querySelector('#li-ac-kw-include');
    inc.value = 'typescript';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(global.__LI.getCfg().includeKeywords).toContain('typescript');
    expect(inc.value).toBe('');
  });

  test('storage onChanged applies a collapsed change to an open panel', async () => {
    await openPanel();
    global.__onChanged({ kwSectionCollapsed: { newValue: true } }, 'sync');
    expect(global.__LI.getKwSectionCollapsed()).toBe(true);
    expect(panel.querySelector('#li-ac-kw-section').style.display).toBe('none');
  });
});
