"use strict";

/**
 * Panel minimize (collapse) feature:
 *  - each floating panel (control #li-ac-panel, found #li-ac-found-panel) gets
 *    a –/+ button in its header that collapses the panel BODY while keeping the
 *    header visible;
 *  - the two panels collapse/expand INDEPENDENTLY;
 *  - state persists via chrome.storage.sync (panelMinimized / foundPanelMinimized),
 *    is honored when loaded at init, applied from storage.onChanged, and survives
 *    renderPanel re-renders (re-scans) and panel recreation.
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

describe('panel minimize (control + found)', () => {
  beforeEach(() => {
    closePanels();
    global.__LI.stopAutoScroll();
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
    global.__LI.setPanelMinimized(false);
    global.__LI.setFoundPanelMinimized(false);
    global.chrome.storage.sync.set.mockClear();
    global.__LI.knownEmailsClear();
    global.__LI.knownKeywordKeysClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.stopAutoScroll();
    global.__LI.setPanelMinimized(false);
    global.__LI.setFoundPanelMinimized(false);
    global.__LI.cleanup();
  });

  async function openPanels() {
    jest.useFakeTimers();
    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
  }

  test('minimize collapses the control panel body but keeps the header', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const body = panel.querySelector('#li-ac-panel-body');
    const btn = panel.querySelector('#li-ac-panel-min');
    expect(body).not.toBeNull();
    expect(body.style.display).toBe(''); // expanded by default
    expect(btn.textContent).toBe('–');

    btn.click();
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(body.style.display).toBe('none'); // body hidden
    expect(btn.textContent).toBe('+'); // button flipped to expand state

    // Header (title + minimize button) stays visible; no close button.
    expect(panel.querySelector('#li-ac-panel-close')).toBeNull();
    expect(panel.textContent).toContain('Job Radar');
    expect(panel.firstElementChild.style.display).not.toBe('none');
  });

  test('clicking minimize again restores the body', async () => {
    await openPanels();
    const body = document.getElementById('li-ac-panel').querySelector('#li-ac-panel-body');
    const btn = document.getElementById('li-ac-panel-min');
    btn.click();
    expect(body.style.display).toBe('none');
    btn.click();
    expect(global.__LI.getPanelMinimized()).toBe(false);
    expect(body.style.display).toBe('');
    expect(btn.textContent).toBe('–');
  });

  test('both panels minimize/expand independently', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    const foundBody = found.querySelector('#li-ac-found-body');
    const foundBtn = found.querySelector('#li-ac-found-min');

    // Minimize only the found panel.
    foundBtn.click();
    expect(global.__LI.getFoundPanelMinimized()).toBe(true);
    expect(foundBody.style.display).toBe('none');
    expect(foundBtn.textContent).toBe('+');
    expect(panel.querySelector('#li-ac-panel-body').style.display).not.toBe('none');

    // Minimize the control panel too -> both collapsed.
    panel.querySelector('#li-ac-panel-min').click();
    expect(panel.querySelector('#li-ac-panel-body').style.display).toBe('none');
    expect(foundBody.style.display).toBe('none');

    // Expand only the control panel -> found stays collapsed (independent).
    panel.querySelector('#li-ac-panel-min').click();
    expect(panel.querySelector('#li-ac-panel-body').style.display).toBe('');
    expect(foundBody.style.display).toBe('none');
    expect(panel.querySelector('#li-ac-panel-min').textContent).toBe('–');
    expect(foundBtn.textContent).toBe('+');
  });

  test('minimize state survives a renderPanel re-render (re-scan)', async () => {
    await openPanels();
    const panel = document.getElementById('li-ac-panel');
    const body = panel.querySelector('#li-ac-panel-body');
    const btn = panel.querySelector('#li-ac-panel-min');
    btn.click();

    document.getElementById('li-ac-found-min').click();

    // Re-scan re-renders panel contents; the same connected panels stay put.
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    expect(document.getElementById('li-ac-panel')).toBe(panel);
    expect(body.style.display).toBe('none');
    expect(btn.textContent).toBe('+');
    expect(document.getElementById('li-ac-found-body').style.display).toBe('none');
    expect(document.getElementById('li-ac-found-min').textContent).toBe('+');

    // Header listeners are NOT double-wired: a single click expands the panel
    // (a doubly-wired listener would toggle twice and net back to collapsed).
    btn.click();
    expect(global.__LI.getPanelMinimized()).toBe(false);
    expect(body.style.display).toBe('');
  });

  test('minimize state persists via chrome.storage.sync with the right keys', async () => {
    await openPanels();
    global.chrome.storage.sync.set.mockClear();

    document.getElementById('li-ac-panel-min').click();
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: true });

    global.chrome.storage.sync.set.mockClear();
    document.getElementById('li-ac-found-min').click();
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ foundPanelMinimized: true });

    global.chrome.storage.sync.set.mockClear();
    document.getElementById('li-ac-panel-min').click(); // expand again
    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: false });
  });

  test('storage.onChanged applies persisted minimize changes to open panels', async () => {
    await openPanels();
    global.__onChanged({ panelMinimized: { newValue: true } }, 'sync');
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(document.getElementById('li-ac-panel-body').style.display).toBe('none');

    global.__onChanged({ foundPanelMinimized: { newValue: true } }, 'sync');
    expect(global.__LI.getFoundPanelMinimized()).toBe(true);
    expect(document.getElementById('li-ac-found-body').style.display).toBe('none');
    expect(document.getElementById('li-ac-found-min').textContent).toBe('+');

    // And back to expanded.
    global.__onChanged({ panelMinimized: { newValue: false } }, 'sync');
    expect(document.getElementById('li-ac-panel-body').style.display).toBe('');
  });

  test('minimize state is honored when a panel is recreated (no close button)', async () => {
    await openPanels();
    document.getElementById('li-ac-panel-min').click(); // panelMinimized = true
    expect(document.getElementById('li-ac-panel-close')).toBeNull();

    // Panels have no close button; remove the DOM node directly to simulate a
    // LinkedIn-side detach. A re-scan recreates the panel.
    document.getElementById('li-ac-panel').remove();
    expect(document.getElementById('li-ac-panel')).toBeNull();

    sendMessage({ type: 'FEED_SCAN' }); // panelDismissed=false -> panel recreated
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const recreated = document.getElementById('li-ac-panel');
    expect(recreated).not.toBeNull();
    expect(global.__LI.getPanelMinimized()).toBe(true);
    expect(recreated.querySelector('#li-ac-panel-body').style.display).toBe('none');
    expect(recreated.querySelector('#li-ac-panel-min').textContent).toBe('+');
  });

  test('minimize buttons use the BW monochrome accent style', async () => {
    await openPanels();
    const panelBtn = document.getElementById('li-ac-panel-min');
    const foundBtn = document.getElementById('li-ac-found-min');
    expect(panelBtn.style.background).toBe('rgb(255, 255, 255)');
    expect(panelBtn.style.color).toBe('rgb(0, 0, 0)');
    expect(foundBtn.style.background).toBe('rgb(255, 255, 255)');
    expect(foundBtn.style.color).toBe('rgb(0, 0, 0)');
  });

  test('minimized panels have no close button — minimize keeps them in the DOM', async () => {
    await openPanels();
    document.getElementById('li-ac-panel-min').click();
    document.getElementById('li-ac-found-min').click();

    // No close buttons exist; both panels stay present (minimize only).
    expect(document.getElementById('li-ac-panel-close')).toBeNull();
    expect(document.getElementById('li-ac-found-close')).toBeNull();
    expect(document.getElementById('li-ac-panel')).not.toBeNull();
    expect(document.getElementById('li-ac-found-panel')).not.toBeNull();
  });

  test('minimized panels stay in the DOM so time-ago refresh keeps updating labels', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const row = found.querySelector('[data-kind="em"][data-key]');
    const ago = row.querySelector('[data-ago]');
    const before = ago.textContent;

    document.getElementById('li-ac-found-min').click();
    expect(found.querySelector('#li-ac-found-body').style.display).toBe('none');

    // Advance past the 10s refresh interval; the hidden label still updates
    // because the minimized panel remains in the DOM.
    await jest.advanceTimersByTimeAsync(11000);
    const after = ago.textContent;
    expect(after).toMatch(/\d+s ago|\d+min ago|\d+h ago/);
    expect(after).not.toBe(before);
  });

  test('expanding the found panel restores its flex body, not a block/empty display', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const body = found.querySelector('#li-ac-found-body');

    // The found body is a flex column wrapper (it lays out the keyword + email
    // lists). Expanding must restore display:flex; setting '' reverts to block
    // and collapses the wrapper to 0 height in the auto-height panel (regression).
    expect(body.style.display).toBe('flex');
    expect(body.style.flexDirection).toBe('column');
  });

  test('found body keeps content-driven flex so its lists scroll internally', async () => {
    await openPanels();
    const found = document.getElementById('li-ac-found-panel');
    const body = found.querySelector('#li-ac-found-body');

    // The wrapper must size to content (flex-basis:auto). flex-basis:0 in an
    // auto-height parent (panel only sets max-height) collapses it to 0 and
    // pushes the email section below the viewport when the keyword list is long.
    expect(body.style.flex).toMatch(/auto/);
    expect(body.style.minHeight).toBe('0');

    // Keyword/email lists keep internal scroll. A list with hits gets an 18vh
    // min-height so it scrolls internally; an empty list collapses to 0.
    const kwList = found.querySelector('#li-ac-kw-list');
    const emList = found.querySelector('#li-ac-panel-list');
    expect(kwList.style.overflowY).toBe('auto');
    expect(emList.style.overflowY).toBe('auto');
    expect(kwList.style.minHeight).toBe('0'); // no include keywords → empty
    expect(emList.style.minHeight).toMatch(/vh/); // email hit present
  });

  test('expanding from minimized also restores the flex body', async () => {
    await openPanels();
    const body = document.getElementById('li-ac-found-body');
    const btn = document.getElementById('li-ac-found-min');
    btn.click();
    expect(body.style.display).toBe('none');
    btn.click();
    expect(global.__LI.getFoundPanelMinimized()).toBe(false);
    expect(body.style.display).toBe('flex');
    expect(btn.textContent).toBe('–');
  });

  test('minimized state is honored when loaded from storage at init', async () => {
    jest.useFakeTimers();
    global.chrome.storage.sync.get.mockImplementationOnce((_defaults, callback) => {
      callback({
        autoExpand: true,
        scanEmails: true,
        includeKeywords: [],
        excludeKeywords: [],
        autoScroll: false,
        debug: true,
        kwSectionCollapsed: false,
        autoScrollDurationMin: 0,
        panelMinimized: true,
        foundPanelMinimized: true
      });
    });
    let LI;
    jest.isolateModules(() => {
      require('../content.js');
    });
    LI = globalThis.__LI_AC_TEST__;
    expect(LI.getPanelMinimized()).toBe(true);
    expect(LI.getFoundPanelMinimized()).toBe(true);

    makePost('React role one bob@example.com');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);

    const panel = document.getElementById('li-ac-panel');
    const found = document.getElementById('li-ac-found-panel');
    expect(panel).not.toBeNull();
    expect(panel.querySelector('#li-ac-panel-body').style.display).toBe('none');
    expect(panel.querySelector('#li-ac-panel-min').textContent).toBe('+');
    expect(found.querySelector('#li-ac-found-body').style.display).toBe('none');
    expect(found.querySelector('#li-ac-found-min').textContent).toBe('+');

    // Header still visible -> can expand back.
    panel.querySelector('#li-ac-panel-min').click();
    expect(panel.querySelector('#li-ac-panel-body').style.display).toBe('');
    expect(LI.getPanelMinimized()).toBe(false);

    expect(global.chrome.storage.sync.set).toHaveBeenCalledWith({ panelMinimized: false });
    LI.cleanup();
  });
});
