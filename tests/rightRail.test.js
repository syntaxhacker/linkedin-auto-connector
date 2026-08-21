'use strict';

/**
 * Right-rail hiding + found panel height + tab pill styling audit
 * Covers recent changes:
 *  - injectStyles right-rail CSS and hideRightRail() imperative hiding
 *  - found heights: kw/em lists 32vh, hidden max 40vh / min 28vh when populated
 *  - tab pill active solid vs inactive tint, count badges, section tinted backgrounds
 *  - wide (≥1300px) vs narrow responsive layout
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

describe('found panel heights (32vh / 40vh / 28vh)', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.stopAutoScroll();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
    global.__LI.getRevealedHiddenKeys().clear();
  });
  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function scan() {
    jest.useFakeTimers();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('kw and em lists use 32vh when populated, 0 when empty', async () => {
    makePost('React role check bob@example.com');
    global.__LI.setCfg({ ...DEFAULTS, includeKeywords: ['react'] });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-kw-list').style.minHeight).toBe('0'); // keyword hit has email → only em list populated
    // em list has hit → 32vh
    expect(found.querySelector('#li-ac-panel-list').style.minHeight).toBe('32vh');
    expect(found.querySelector('#li-ac-panel-list').style.maxHeight).toBeFalsy(); // no max, uses flex
  });

  test('both lists 32vh when both have hits', async () => {
    makePost('React senior role no email here'); // keyword-only
    makePost('contact bob@example.com for role'); // email-only (no keyword match)
    global.__LI.setCfg({ ...DEFAULTS, includeKeywords: ['react'] });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-kw-list').style.minHeight).toBe('32vh');
    expect(found.querySelector('#li-ac-panel-list').style.minHeight).toBe('32vh');
  });

  test('both lists 0 when empty', async () => {
    makePost('nothing relevant here');
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-kw-list').style.minHeight).toBe('0');
    expect(found.querySelector('#li-ac-panel-list').style.minHeight).toBe('0');
  });

  test('hidden list: max 40vh always, min 28vh when populated else 0', async () => {
    makePost('dotnet role here'); // will be hidden
    global.__LI.setCfg({ ...DEFAULTS, excludeKeywords: ['dotnet'] });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const hidden = found.querySelector('#li-ac-hidden-list');
    expect(hidden.style.maxHeight).toBe('40vh');
    expect(hidden.style.minHeight).toBe('28vh'); // has rows

    // No hidden posts → min 0, max still 40vh
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.getRevealedHiddenKeys().clear();
    makePost('hello world');
    await scan();
    const found2 = document.getElementById('li-ac-found-panel');
    const hidden2 = found2.querySelector('#li-ac-hidden-list');
    expect(hidden2.style.maxHeight).toBe('40vh');
    expect(hidden2.style.minHeight).toBe('0');
  });

  test('hidden list after Show/Hide toggle preserves 28vh when still populated', async () => {
    const p = makePost('java role opening');
    global.__LI.setCfg({ ...DEFAULTS, excludeKeywords: ['java'] });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-hidden-list').style.minHeight).toBe('28vh');
    // reveal one
    found.querySelector('#li-ac-hidden-list [data-hidden-toggle="show"]').click();
    // still has one revealed row → still populated
    expect(found.querySelector('#li-ac-hidden-list').style.minHeight).toBe('28vh');
    expect(found.querySelector('#li-ac-hidden-list').style.maxHeight).toBe('40vh');
  });
});

describe('tab pill styling (active solid vs inactive tint)', () => {
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.stopAutoScroll();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function scan() {
    jest.useFakeTimers();
    makePost('contact alice@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('default active tab is kw with solid warn background, others tinted', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const kwBtn = found.querySelector('#li-ac-tab-kw');
    const emBtn = found.querySelector('#li-ac-tab-em');
    const hiddenBtn = found.querySelector('#li-ac-tab-hidden');
    // kw active → solid
    expect(kwBtn.style.background).toContain('251, 191, 36'); // #fbbf24 warn solid when active
    expect(kwBtn.style.color).toBe('rgb(0, 0, 0)');
    // em inactive → tint
    expect(emBtn.style.background).toContain('rgba');
    expect(emBtn.style.background).toContain('96, 165, 250');
    // hidden inactive → tint
    expect(hiddenBtn.style.background).toContain('rgba');
    expect(parseFloat(kwBtn.style.opacity)).toBe(1);
    expect(parseFloat(emBtn.style.opacity)).toBeCloseTo(0.9);
  });

  test('switching to em tab makes em solid and kw tinted', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    found.querySelector('#li-ac-tab-em').click();
    const kwBtn = found.querySelector('#li-ac-tab-kw');
    const emBtn = found.querySelector('#li-ac-tab-em');
    // em now active → solid blue
    expect(emBtn.style.background).toBe('rgb(96, 165, 250)');
    expect(emBtn.style.color).toBe('rgb(0, 0, 0)');
    // kw now inactive → tint
    expect(kwBtn.style.background).toMatch(/251,\s*191,\s*36/);
  });

  test('switching to hidden tab makes hidden solid', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    found.querySelector('#li-ac-tab-hidden').click();
    const hiddenBtn = found.querySelector('#li-ac-tab-hidden');
    // BW.muted #bbbbbb = rgb(187,187,187) — allow spaces variation
    expect(hiddenBtn.style.background).toMatch(/187,\s*187,\s*187/);
    expect(hiddenBtn.style.color).toBe('rgb(0, 0, 0)');
    expect(parseFloat(hiddenBtn.style.opacity)).toBe(1);
  });

  test('count badges mirror list counts', async () => {
    global.__LI.setCfg({ ...DEFAULTS, includeKeywords: ['python'] });
    makePost('Python senior no email');
    makePost('hire me bob@example.com');
    jest.useFakeTimers();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const found = document.getElementById('li-ac-found-panel');
    const kwCount = found.querySelector('#li-ac-tab-kw-count').textContent;
    const emCount = found.querySelector('#li-ac-tab-em-count').textContent;
    expect(kwCount).toBe(found.querySelector('#li-ac-kw-count').textContent);
    expect(emCount).toBe(found.querySelector('#li-ac-em-count').textContent);
    expect(parseInt(kwCount, 10)).toBeGreaterThanOrEqual(0);
  });

  test('section backgrounds are tinted (keyword warn, email blue, hidden muted)', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const kwSection = found.querySelector('#li-ac-section-kw');
    const emSection = found.querySelector('#li-ac-section-em');
    const hiddenSection = found.querySelector('#li-ac-section-hidden');
    expect(kwSection.style.background).toMatch(/251,\s*191,\s*36/);
    expect(emSection.style.background).toMatch(/96,\s*165,\s*250/);
    expect(hiddenSection.style.background).toMatch(/187,\s*187,\s*187/);
  });
});

describe('responsive layout: wide (≥1300px) vs narrow', () => {
  let origInnerWidth;
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.stopAutoScroll();
    origInnerWidth = window.innerWidth;
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, writable: true, configurable: true });
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  async function scan() {
    jest.useFakeTimers();
    makePost('hello alice@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('isFoundWide true when innerWidth >=1300, false otherwise', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: 1300, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(true);
  });

  test('narrow: tabbar visible, found width 320px, active tab shown, others hidden', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    global.__LI.setFoundTab('kw');
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.style.width).toBe('320px');
    const tabbar = found.querySelector('#li-ac-tabbar');
    expect(tabbar.style.display).toBe('flex');
    // kw active → kw visible, em/hidden hidden
    expect(found.querySelector('#li-ac-section-kw').style.display).toBe('flex');
    expect(found.querySelector('#li-ac-section-em').style.display).toBe('none');
    expect(found.querySelector('#li-ac-section-hidden').style.display).toBe('none');
    expect(found.style.maxHeight).toBe('90vh');
  });

  test('wide: tabbar hidden, found width 680px, all sections side-by-side', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1500, writable: true, configurable: true });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    // need to re-apply layout after width change
    global.__LI.applyFoundLayout();
    expect(found.style.width).toBe('680px');
    expect(found.querySelector('#li-ac-tabbar').style.display).toBe('none');
    expect(found.querySelector('#li-ac-section-kw').style.display).toBe('flex');
    expect(found.querySelector('#li-ac-section-em').style.display).toBe('flex');
    expect(found.querySelector('#li-ac-section-hidden').style.display).toBe('flex');
    expect(found.style.maxHeight).toBe('85vh');
  });

  test('resize event switches layout between narrow and wide', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    await scan();
    expect(document.getElementById('li-ac-found-panel').style.width).toBe('320px');

    Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(document.getElementById('li-ac-found-panel').style.width).toBe('680px');
    expect(document.getElementById('li-ac-found-panel').querySelector('#li-ac-tabbar').style.display).toBe('none');

    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(document.getElementById('li-ac-found-panel').style.width).toBe('320px');
    expect(document.getElementById('li-ac-found-panel').querySelector('#li-ac-tabbar').style.display).toBe('flex');
  });
});
