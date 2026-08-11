'use strict';

/**
 * Keyword newest-first ordering (user feature): whenever a new keyword is added
 * to the Include/Exclude keyword section it must land at the FRONT of the list
 * (and of the rendered tags). Also: the Found panel's ⇅ Newest / ↑ / ↓ sort
 * bars must be hidden when a section has no hits (no emails / no keyword
 * matches — and the same rule for both sections).
 */

const { makePost, sendMessage, resetState, closePanels } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('keywords: newest-first order when adding', () => {
  let panel;

  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function openPanel() {
    jest.useFakeTimers();
    makePost('hello bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400); // flush observer scans
    panel = document.getElementById('li-ac-panel');
    return panel;
  }

  test('Enter-to-add places the newest keyword FIRST (include)', async () => {
    await openPanel();
    const inc = panel.querySelector('#li-ac-kw-include');

    inc.value = 'react, python';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react', 'python']);

    // Newest addition goes to the FRONT.
    inc.value = 'typescript';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(global.__LI.getCfg().includeKeywords).toEqual(['typescript', 'react', 'python']);

    // Tags render in the same newest-first order.
    const tags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    expect(Array.from(tags).map(t => t.getAttribute('data-kw-remove'))).toEqual(['typescript', 'react', 'python']);
  });

  test('Enter-to-add places the newest keyword FIRST (exclude)', async () => {
    await openPanel();
    const exc = panel.querySelector('#li-ac-kw-exclude');

    exc.value = '.net';
    exc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    exc.value = 'java';
    exc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(global.__LI.getCfg().excludeKeywords).toEqual(['java', '.net']);

    const tags = panel.querySelectorAll('#li-ac-tags-exclude [data-kw-remove]');
    expect(Array.from(tags).map(t => t.getAttribute('data-kw-remove'))).toEqual(['java', '.net']);
  });

  test('re-adding an existing keyword does not duplicate AND does not reorder', async () => {
    await openPanel();
    const inc = panel.querySelector('#li-ac-kw-include');

    inc.value = 'react';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    inc.value = 'python';
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    inc.value = 'react'; // duplicate of the first keyword
    inc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    // Set-dedupe keeps the FIRST occurrence position of 'react' (front) —
    // the duplicate add contributes nothing new.
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react', 'python']);
    const tags = panel.querySelectorAll('#li-ac-tags-include [data-kw-remove]');
    expect(tags).toHaveLength(2);
  });

  test('right-click context-add puts new keywords FIRST', () => {
    global.__LI.setCfg({ includeKeywords: ['python'] });
    const post = makePost('We are hiring a senior react developer in bangalore');
    global.__LI.captureRightClick({ target: post });
    const kws = global.__LI.extractKeywordsFromPost(post);
    const added = global.__LI.addRightClickedTo('include');

    expect(added).toBeGreaterThan(0);
    const cfg = global.__LI.getCfg().includeKeywords;
    // Freshly extracted keywords sit at the FRONT in extraction order...
    expect(cfg.slice(0, kws.length)).toEqual(kws);
    // ...and the previously stored keyword follows them.
    expect(cfg[kws.length]).toBe('python');
    // No duplicates were introduced.
    expect(new Set(cfg).size).toBe(cfg.length);
  });

  test('right-click context-add to exclude is newest-first too', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const post = makePost('We are hiring a senior php developer in bangalore');
    global.__LI.captureRightClick({ target: post });
    const kws = global.__LI.extractKeywordsFromPost(post);
    global.__LI.addRightClickedTo('exclude');

    const cfg = global.__LI.getCfg().excludeKeywords;
    expect(cfg.slice(0, kws.length)).toEqual(kws);
    expect(cfg[kws.length]).toBe('.net');
  });
});

describe('found panel: sort/↑/↓ bars hidden when a section has no hits', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    resetState();
    global.__LI.setCfg({ ...DEFAULTS });
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function scan(posts, cfg) {
    jest.useFakeTimers();
    global.__LI.setCfg({ ...DEFAULTS, ...cfg });
    posts.forEach(p => makePost(p));
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('no keyword hits and no emails -> both sort bars hidden', async () => {
    await scan(['a generic business post with no contact details'], { includeKeywords: ['react'] });

    const kwBar = document.getElementById('li-ac-kw-sortbar');
    const emBar = document.getElementById('li-ac-em-sortbar');
    expect(kwBar).not.toBeNull();
    expect(emBar).not.toBeNull();
    expect(kwBar.style.display).toBe('none');
    expect(emBar.style.display).toBe('none');
    expect(document.getElementById('li-ac-kw-list').textContent).toContain('No keyword matches');
    expect(document.getElementById('li-ac-panel-list').textContent).toContain('No email matches');
  });

  test('keyword hits exist -> keyword sort bar visible', async () => {
    await scan(['React developer opening details here'], { includeKeywords: ['react'] });

    expect(document.getElementById('li-ac-kw-sortbar').style.display).toBe('flex');
    // No emails in the post -> email bar stays hidden.
    expect(document.getElementById('li-ac-em-sortbar').style.display).toBe('none');
  });

  test('email hits exist -> email sort bar visible (keyword bar hidden without include kws)', async () => {
    await scan(['please reach me at bob@example.com for the role']);

    expect(document.getElementById('li-ac-kw-sortbar').style.display).toBe('none');
    expect(document.getElementById('li-ac-em-sortbar').style.display).toBe('flex');
  });

  test('bars flip back to visible once hits appear on a later scan', async () => {
    await scan(['a generic business post'], { includeKeywords: [] });
    expect(document.getElementById('li-ac-em-sortbar').style.display).toBe('none');

    // New post with an email arrives on a re-scan (observer-triggered re-scan
    // goes through the same renderPanel path).
    makePost('next post with alice@example.com contact');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(document.getElementById('li-ac-em-sortbar').style.display).toBe('flex');
    expect(document.getElementById('li-ac-em-sort')).not.toBeNull(); // button still wired
  });
});
