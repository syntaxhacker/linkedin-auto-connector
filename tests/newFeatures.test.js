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
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
    global.__LI.getRevealedHiddenKeys().clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.cleanup();
  });

  async function openPanelWithHits() {
    jest.useFakeTimers();
    global.__LI.setCfg({ includeKeywords: ['react'] });
    // Posts with emails land in the email list; keyword-only posts land in the
    // keyword list (a post with both is listed only under emails).
    makePost('React role one bob@example.com');
    makePost('React role two carol@example.com');
    makePost('React role three dan@example.com');
    makePost('React senior role, no contact details in this one');
    makePost('React architect role, also no contact details here');
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

  test('↑/↓ arrow buttons are removed; only the Newest sort button remains', async () => {
    await openPanelWithHits();
    // Arrows removed per the redesign — only the Newest toggle stays.
    expect(found.querySelector('#li-ac-em-up')).toBeNull();
    expect(found.querySelector('#li-ac-em-down')).toBeNull();
    expect(found.querySelector('#li-ac-kw-up')).toBeNull();
    expect(found.querySelector('#li-ac-kw-down')).toBeNull();
    expect(found.querySelector('#li-ac-em-sort')).not.toBeNull();
    expect(found.querySelector('#li-ac-kw-sort')).not.toBeNull();
  });

  test('Newest sort is the default and the toggle reverts to feed order', async () => {
    await openPanelWithHits();
    const list = found.querySelector('#li-ac-panel-list');

    // Mark the first email hit as older by manipulating hitMeta firstSeen.
    const rows0 = Array.from(list.querySelectorAll('[data-idx]'));
    expect(rows0.length).toBeGreaterThanOrEqual(2);
    const key0 = rows0[0].getAttribute('data-key');
    const meta0 = global.__LI.hitMeta().get('em:' + key0);
    meta0.firstSeen = Date.now() - 60000;

    // Re-scan re-renders with the default newest-first sort → the now-older
    // row0 should NOT be first anymore.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const rowsAfter = Array.from(found.querySelector('#li-ac-panel-list').querySelectorAll('[data-idx]'));
    expect(rowsAfter[0].getAttribute('data-key')).not.toBe(key0);

    // Toggle sort off via the button → back to feed order, row0 first again.
    found.querySelector('#li-ac-em-sort').click();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const feedRows = Array.from(found.querySelector('#li-ac-panel-list').querySelectorAll('[data-idx]'));
    expect(feedRows[0].getAttribute('data-key')).toBe(key0);
  });

  test('panel rows use larger font sizes (headline 14px, snippet 12px)', async () => {
    await openPanelWithHits();
    const firstRow = found.querySelector('#li-ac-panel-list [data-idx]');
    const headline = firstRow.firstElementChild;
    const snippet = firstRow.children[1];
    expect(headline.style.fontSize).toBe('14px');
    expect(snippet.style.fontSize).toBe('12px');
  });

  test('per-post Show reveals hidden posts without a re-scan', async () => {
    await openPanelWithHits();
    // Hide a post via exclude, then reveal it from the Found panel's Hidden list.
    global.__LI.setCfg({ excludeKeywords: ['one'] });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(global.__LI.getHiddenCount()).toBeGreaterThan(0);

    const foundPanelEl = document.getElementById('li-ac-found-panel');
    // Re-query each iteration: the synchronous re-render swaps the rows, so a
    // stale NodeList would detach the remaining Show buttons.
    let showBtn = foundPanelEl.querySelector('#li-ac-hidden-list [data-hidden-toggle="show"]');
    while (showBtn) {
      showBtn.click();
      showBtn = foundPanelEl.querySelector('#li-ac-hidden-list [data-hidden-toggle="show"]');
    }
    expect(global.__LI.getHiddenCount()).toBe(0);
    // revealed post is back in the live post set
    expect(global.__LI.getPosts().length).toBeGreaterThan(0);
  });

  test('Hidden list lists hidden posts with a per-post Show toggle', async () => {
    await openPanelWithHits();
    global.__LI.setCfg({ excludeKeywords: ['one'] });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    const hiddenList = found.querySelector('#li-ac-hidden-list');
    expect(hiddenList).not.toBeNull();
    expect(hiddenList.querySelectorAll('[data-hidden-key]').length).toBeGreaterThan(0);

    const showBtn = hiddenList.querySelector('[data-hidden-toggle="show"]');
    expect(showBtn).not.toBeNull();
    showBtn.click();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    // That one post is revealed: not in the hidden list anymore, no longer hidden.
    const hiddenAfter = global.__LI.getHiddenPosts();
    expect(hiddenAfter.length).toBeLessThan(global.__LI.getHiddenCount() + 1);
    // And it reappears in the live post set (getPosts excludes hidden posts).
    expect(global.__LI.getPosts().length).toBeGreaterThan(0);
  });

  test('re-hiding a revealed post works from the Hidden list', async () => {
    await openPanelWithHits();
    global.__LI.setCfg({ excludeKeywords: ['one'] });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    const hiddenList = found.querySelector('#li-ac-hidden-list');
    const showBtn = hiddenList.querySelector('[data-hidden-toggle="show"]');
    const key = showBtn.closest('[data-hidden-key]').getAttribute('data-hidden-key');
    showBtn.click();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    // The revealed post now renders with a Hide button.
    const hideBtn = found.querySelector('[data-hidden-toggle="hide"]');
    expect(hideBtn).not.toBeNull();
    expect(hideBtn.closest('[data-hidden-key]').getAttribute('data-hidden-key')).toBe(key);
    hideBtn.click();
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    // Back to hidden.
    expect(global.__LI.getHiddenPosts().some(p => global.__LI.postKey(p) === key)).toBe(true);
    expect(found.querySelector('[data-hidden-toggle="show"]')).not.toBeNull();
  });

  test('clicking a hidden list row scrolls to the hidden post in the feed', async () => {
    await openPanelWithHits();
    global.__LI.setCfg({ excludeKeywords: ['one'] });
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const found = document.getElementById('li-ac-found-panel');
    const hiddenList = found.querySelector('#li-ac-hidden-list');
    const row = hiddenList.querySelector('[data-hidden-key]');
    expect(row).not.toBeNull();

    // Click the row TEXT (not the Show button) → scrollIntoView fires.
    const textEl = row.firstElementChild;
    expect(() => textEl.click()).not.toThrow();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
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
    global.__LI.sortNewest.kw = true;
    global.__LI.sortNewest.em = true;
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

  test('found lists have dynamic heights: hits get 18vh, empty collapses to 0', async () => {
    await open();
    const found = document.getElementById('li-ac-found-panel');
    const kwList = found.querySelector('#li-ac-kw-list');
    const emList = found.querySelector('#li-ac-panel-list');
    // No include keywords → keyword list empty → collapsed.
    expect(kwList.style.minHeight).toBe('0');
    // Email hits present → keeps its 18vh min.
    expect(emList.style.minHeight).toBe('18vh');
    // The Hidden list gets a real minimum when it has rows (squeeze-proof).
    const hiddenList = found.querySelector('#li-ac-hidden-list');
    expect(hiddenList.style.minHeight).toBe('0'); // no hidden posts
    expect(hiddenList.style.maxHeight).toBe('35vh');
  });

  test('panels have no close button (minimize only)', async () => {
    await open();
    expect(document.getElementById('li-ac-panel-close')).toBeNull();
    expect(document.getElementById('li-ac-found-close')).toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
  });

  test('RESET clears both panels', async () => {
    await open();
    sendMessage({ type: 'RESET' });
    expect(document.getElementById('li-ac-panel')).toBeNull();
    expect(document.getElementById('li-ac-found-panel')).toBeNull();
  });

  test('found panel stays offset from the control panel (both always present)', async () => {
    await open();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.style.right).toBe('348px');
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
  });

  test('sort button shows a distinct active color (newest) vs inactive (feed order)', async () => {
    await open();
    const found = document.getElementById('li-ac-found-panel');
    const btn = found.querySelector('#li-ac-em-sort');
    // Newest-first is the default → active (blue), label "⇅ Newest".
    expect(btn.style.background).toBe('rgb(96, 165, 250)'); // #60a5fa
    expect(btn.textContent).toBe('⇅ Newest');
    btn.click();
    // Toggled off → feed order, white background, label updated.
    expect(btn.style.background).toBe('rgb(255, 255, 255)');
    expect(btn.textContent).toBe('Feed order');
    btn.click();
    // Back to active.
    expect(btn.style.background).toBe('rgb(96, 165, 250)');
  });
});

describe('collapsible keywords section', () => {
  let panel;
  beforeEach(() => {
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
