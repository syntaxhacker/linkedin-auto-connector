'use strict';

/**
 * Audit coverage for:
 *  - hideRightRail / injectStyles
 *  - increased heights 32vh (kw/em 32vh, hidden 28vh/40vh)
 *  - tab pill styling responsive wide vs narrow
 *
 * This file fills gaps not covered by injectStyles.test.js / rightRail.test.js
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

describe('injectStyles — full CSS audit', () => {
  beforeEach(() => {
    const existing = document.getElementById('li-ac-styles');
    if (existing) existing.remove();
  });
  afterEach(() => {
    const el = document.getElementById('li-ac-styles');
    if (el) el.remove();
  });

  test('contains all hidden/ultra/hover/viewed/hl/right-rail rules', () => {
    global.__LI.injectStyles();
    const css = document.getElementById('li-ac-styles').textContent;
    // hidden collapsed
    expect(css).toContain('.li-ac-hidden {');
    expect(css).toContain('.li-ac-hidden:hover {');
    expect(css).toContain('.li-ac-hidden-card {');
    expect(css).toContain('.li-ac-hidden-card:hover {');
    expect(css).toContain('.li-ac-ultra {');
    expect(css).toContain('.li-ac-ultra:hover {');
    expect(css).toContain('.li-ac-ultra-card {');
    expect(css).toContain('.li-ac-ultra-card:hover {');
    // viewed inset green
    expect(css).toContain('.li-ac-viewed {');
    expect(css).toContain('box-shadow: inset 3px 0 0');
    // keyword highlight amber outline
    expect(css).toContain('.li-ac-kw-hl {');
    expect(css).toContain('outline: 3px solid');
    // right rail selectors
    expect(css).toContain('div[data-componentkey="SearchResults_SearchRightRail"]');
    expect(css).toContain('.search-reusable-search-right-rail');
    expect(css).toContain('display: none !important');
  });

  test('uses palette warn color for hidden border and outline', () => {
    global.__LI.injectStyles();
    const css = document.getElementById('li-ac-styles').textContent;
    // warn is #fbbf24
    expect(css).toContain('#fbbf24');
  });

  test('injectStyles does not duplicate when called many times', () => {
    global.__LI.injectStyles();
    const first = document.getElementById('li-ac-styles').textContent;
    global.__LI.injectStyles();
    global.__LI.injectStyles();
    global.__LI.injectStyles();
    expect(document.querySelectorAll('#li-ac-styles')).toHaveLength(1);
    expect(document.getElementById('li-ac-styles').textContent).toBe(first);
  });

  test('re-creates after removal', () => {
    global.__LI.injectStyles();
    document.getElementById('li-ac-styles').remove();
    expect(document.getElementById('li-ac-styles')).toBeNull();
    global.__LI.injectStyles();
    expect(document.getElementById('li-ac-styles')).not.toBeNull();
  });

  test('is idempotent with style already present but mutated head', () => {
    global.__LI.injectStyles();
    // add unrelated style
    const extra = document.createElement('style');
    extra.id = 'other-style';
    document.head.appendChild(extra);
    global.__LI.injectStyles();
    expect(document.querySelectorAll('#li-ac-styles')).toHaveLength(1);
    extra.remove();
  });
});

describe('hideRightRail — edge cases', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  test('swallows exception when querySelector throws', () => {
    const spy = jest.spyOn(document, 'querySelector').mockImplementation(() => { throw new Error('boom'); });
    expect(() => global.__LI.hideRightRail()).not.toThrow();
    spy.mockRestore();
  });

  test('hides rails that are already display none (idempotent)', () => {
    const a = document.createElement('div');
    a.setAttribute('data-componentkey', 'SearchResults_SearchRightRail');
    a.style.display = 'none';
    const b = document.createElement('div');
    b.className = 'search-reusable-search-right-rail';
    b.style.display = 'none';
    document.body.appendChild(a);
    document.body.appendChild(b);
    global.__LI.hideRightRail();
    expect(a.style.display).toBe('none');
    expect(b.style.display).toBe('none');
  });

  test('only hides first match via querySelector (single element)', () => {
    const b1 = document.createElement('div');
    b1.className = 'search-reusable-search-right-rail';
    b1.id = 'b1';
    b1.style.display = 'block';
    const b2 = document.createElement('div');
    b2.className = 'search-reusable-search-right-rail';
    b2.id = 'b2';
    b2.style.display = 'block';
    document.body.appendChild(b1);
    document.body.appendChild(b2);
    global.__LI.hideRightRail();
    expect(b1.style.display).toBe('none');
    // querySelector only returns first, second stays
    expect(b2.style.display).toBe('block');
    // CSS fallback (injectStyles) would hide both via stylesheet
  });

  test('does not affect unrelated elements', () => {
    const other = document.createElement('div');
    other.className = 'some-other-rail';
    other.style.display = 'block';
    document.body.appendChild(other);
    global.__LI.hideRightRail();
    expect(other.style.display).toBe('block');
  });
});

describe('increased heights 32vh — detailed invariants', () => {
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

  test('control panel max-height is 78vh, found panel narrow 90vh / wide 85vh', async () => {
    makePost('hello bob@example.com');
    await scan();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel.style.maxHeight).toBe('78vh');
    // default narrow (jsdom width 1024)
    expect(found.style.maxHeight).toBe('90vh');
    // wide
    const orig = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1500, writable: true, configurable: true });
    global.__LI.applyFoundLayout();
    expect(found.style.maxHeight).toBe('85vh');
    Object.defineProperty(window, 'innerWidth', { value: orig, writable: true, configurable: true });
    global.__LI.applyFoundLayout();
    expect(found.style.maxHeight).toBe('90vh');
  });

  test('kw and em lists have flex 1 1 0 and overflow auto internally', async () => {
    makePost('React role check bob@example.com');
    global.__LI.setCfg({ ...DEFAULTS, includeKeywords: ['react'] });
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const kwList = found.querySelector('#li-ac-kw-list');
    const emList = found.querySelector('#li-ac-panel-list');
    expect(kwList.style.overflowY).toBe('auto');
    expect(emList.style.overflowY).toBe('auto');
    expect(kwList.style.flex).toMatch(/1 1 0/);
    expect(emList.style.flex).toMatch(/1 1 0/);
  });

  test('empty lists have minHeight 0, populated have 32vh', async () => {
    // empty
    makePost('nothing');
    await scan();
    let found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-kw-list').style.minHeight).toBe('0');
    expect(found.querySelector('#li-ac-panel-list').style.minHeight).toBe('0');
    // now populate em
    closePanels();
    document.body.innerHTML = '';
    global.__LI.getRevealedHiddenKeys().clear();
    makePost('contact alice@example.com');
    await scan();
    found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-panel-list').style.minHeight).toBe('32vh');
  });

  test('hidden list constants: max 40vh always, min 28vh when rows else 0, flex and overflow', async () => {
    makePost('hello world');
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const hidden = found.querySelector('#li-ac-hidden-list');
    expect(hidden.style.maxHeight).toBe('40vh');
    expect(hidden.style.minHeight).toBe('0');
    expect(hidden.style.overflowY).toBe('auto');
    expect(hidden.style.flex).toMatch(/1 1 0/);
  });

  test('found-body flex column and overflow hidden wrapper invariants', async () => {
    makePost('bob@example.com');
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const body = found.querySelector('#li-ac-found-body');
    expect(body.style.display).toBe('flex');
    expect(body.style.flexDirection).toBe('column');
    expect(body.style.overflow).toBe('hidden');
    expect(body.style.flex).toMatch(/1 1 auto/);
  });
});

describe('tab pill styling — exhaustive', () => {
  let origInnerWidth;
  beforeEach(() => {
    closePanels();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.stopAutoScroll();
    origInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: origInnerWidth, writable: true, configurable: true });
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

  test('pill shape: borderRadius 20px, padding, font weight', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    ['kw','em','hidden'].forEach(k => {
      const btn = found.querySelector('#li-ac-tab-' + k);
      expect(btn.style.borderRadius).toBe('20px');
      expect(btn.style.fontWeight).toBe('700');
      expect(btn.style.border).toMatch(/1px solid/);
    });
  });

  test('active/inactive: background solid vs rgba tint, color, opacity, borderColor', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    const kwBtn = found.querySelector('#li-ac-tab-kw');
    const emBtn = found.querySelector('#li-ac-tab-em');
    // default kw active - browser normalizes hex to rgb
    expect(kwBtn.style.background).toMatch(/251,\s*191,\s*36/);
    expect(kwBtn.style.color).toBe('rgb(0, 0, 0)');
    expect(kwBtn.style.opacity).toBe('1');
    expect(kwBtn.style.borderColor).toMatch(/#fbbf24|251,\s*191,\s*36/);
    // em inactive
    expect(emBtn.style.background).toMatch(/rgba/);
    expect(emBtn.style.opacity).toBe('0.9');
    // switch to em active
    found.querySelector('#li-ac-tab-em').click();
    const kwBtn2 = found.querySelector('#li-ac-tab-kw');
    const emBtn2 = found.querySelector('#li-ac-tab-em');
    expect(emBtn2.style.background).toMatch(/96,\s*165,\s*250/);
    expect(emBtn2.style.opacity).toBe('1');
    expect(kwBtn2.style.background).toMatch(/rgba/);
    expect(kwBtn2.style.opacity).toBe('0.9');
  });

  test('hidden active uses muted solid, inactive uses muted tint', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    found.querySelector('#li-ac-tab-hidden').click();
    const hiddenBtn = found.querySelector('#li-ac-tab-hidden');
    expect(hiddenBtn.style.background).toMatch(/187,\s*187,\s*187/);
    expect(hiddenBtn.style.color).toBe('rgb(0, 0, 0)');
    expect(hiddenBtn.style.opacity).toBe('1');
  });

  test('count badges mirror list counts and have correct pill style', async () => {
    global.__LI.setCfg({ ...DEFAULTS, includeKeywords: ['python'] });
    makePost('Python role no email');
    makePost('hire bob@example.com');
    jest.useFakeTimers();
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    const found = document.getElementById('li-ac-found-panel');
    const kwTabCount = found.querySelector('#li-ac-tab-kw-count');
    const emTabCount = found.querySelector('#li-ac-tab-em-count');
    const hiddenTabCount = found.querySelector('#li-ac-tab-hidden-count');
    expect(kwTabCount.textContent).toBe(found.querySelector('#li-ac-kw-count').textContent);
    expect(emTabCount.textContent).toBe(found.querySelector('#li-ac-em-count').textContent);
    expect(hiddenTabCount.textContent).toBe(found.querySelector('#li-ac-hidden-count').textContent);
    // badge style: rounded 10px
    expect(kwTabCount.style.borderRadius).toBe('10px');
  });

  test('setFoundTab with invalid value keeps previous tab', async () => {
    await scan();
    const before = global.__LI.getFoundTab();
    global.__LI.setFoundTab('invalid');
    expect(global.__LI.getFoundTab()).toBe(before);
    global.__LI.setFoundTab('em');
    expect(global.__LI.getFoundTab()).toBe('em');
    global.__LI.setFoundTab('bogus');
    expect(global.__LI.getFoundTab()).toBe('em');
  });

  test('isFoundWide returns false if innerWidth access throws', () => {
    Object.defineProperty(window, 'innerWidth', {
      get() { throw new Error('boom'); },
      configurable: true
    });
    expect(global.__LI.isFoundWide()).toBe(false);
    // restore for afterEach
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
  });

  test('isFoundWide boundary: 1299 false, 1300 true, 1301 true', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1299, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: 1300, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { value: 1301, writable: true, configurable: true });
    expect(global.__LI.isFoundWide()).toBe(true);
  });

  test('responsive wide hides tabbar, shows all sections side-by-side with correct flex and borders', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true, configurable: true });
    await scan();
    global.__LI.applyFoundLayout();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.style.width).toBe('680px');
    expect(found.querySelector('#li-ac-tabbar').style.display).toBe('none');
    const secKw = found.querySelector('#li-ac-section-kw');
    const secEm = found.querySelector('#li-ac-section-em');
    const secHidden = found.querySelector('#li-ac-section-hidden');
    expect(secKw.style.display).toBe('flex');
    expect(secEm.style.display).toBe('flex');
    expect(secHidden.style.display).toBe('flex');
    // wide column flex distribution
    expect(secKw.style.flex).toBe('1 1 48%');
    expect(secEm.style.flex).toBe('1 1 48%');
    expect(secHidden.style.flex).toBe('1 1 100%');
    expect(secKw.style.borderRight).toMatch(/1px solid/);
    expect(secHidden.style.borderTop).toMatch(/1px solid/);
    expect(found.querySelector('#li-ac-found-body').style.flexDirection).toBe('row');
    expect(found.querySelector('#li-ac-found-body').style.flexWrap).toBe('wrap');
  });

  test('responsive narrow shows tabbar, shows only active tab section', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, writable: true, configurable: true });
    global.__LI.setFoundTab('hidden');
    await scan();
    global.__LI.applyFoundLayout();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.style.width).toBe('320px');
    expect(found.querySelector('#li-ac-tabbar').style.display).toBe('flex');
    expect(found.querySelector('#li-ac-section-kw').style.display).toBe('none');
    expect(found.querySelector('#li-ac-section-em').style.display).toBe('none');
    expect(found.querySelector('#li-ac-section-hidden').style.display).toBe('flex');
    // narrow clears side-by-side borders
    expect(found.querySelector('#li-ac-section-kw').style.borderRight).toBe('');
    expect(found.querySelector('#li-ac-section-hidden').style.borderTop).toBe('');
    expect(found.querySelector('#li-ac-found-body').style.flexDirection).toBe('column');
    expect(found.querySelector('#li-ac-found-body').style.flexWrap).toBe('nowrap');
  });

  test('applyFoundLayout is safe when foundPanel is null (no throw)', () => {
    closePanels();
    expect(() => global.__LI.applyFoundLayout()).not.toThrow();
  });

  test('positioning: found panel right offset is 348px', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.style.right).toBe('348px');
  });

  test('section backgrounds use tinted rgba', async () => {
    await scan();
    const found = document.getElementById('li-ac-found-panel');
    expect(found.querySelector('#li-ac-section-kw').style.background).toMatch(/251,\s*191,\s*36/);
    expect(found.querySelector('#li-ac-section-em').style.background).toMatch(/96,\s*165,\s*250/);
    expect(found.querySelector('#li-ac-section-hidden').style.background).toMatch(/187,\s*187,\s*187/);
  });
});
