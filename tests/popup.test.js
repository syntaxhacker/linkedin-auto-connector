/**
 * popup.test.js
 *
 * Unit tests for popup.js — the action popup's controller.
 *
 * Strategy: extract the <body> markup from popup.html into jsdom, stub a
 * controllable chrome.* (tabs.query / tabs.sendMessage / storage.sync), then
 * require popup.js fresh for each test. Because popup.js is a plain script
 * (no exports), jest.resetModules() + a fresh DOM give us a clean instance.
 */

const fs = require('fs');
const path = require('path');

const POPUP_HTML = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const BODY_HTML = POPUP_HTML.match(/<body>([\s\S]*?)<\/body>/)[1];

const WARNING = '⚠ Min delay must be ≤ max (both ≥ 500 ms)';

let sendMessageMock;   // jest.fn((tabId, msg, cb) => ...) — response per msg.type
let storageSetMock;
let lastError;         // value to expose as chrome.runtime.lastError
let tabUrl;            // URL returned by tabs.query
let responses;         // { SCAN: {...}, START: {...}, ... }

function loadPopup() {
  document.body.innerHTML = BODY_HTML;
  jest.resetModules();
  global.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: jest.fn() }
    },
    storage: {
      sync: {
        get: jest.fn((defaults, cb) => cb({ delayMin: 1500, delayMax: 3000 })),
        set: storageSetMock
      }
    },
    tabs: {
      query: jest.fn((_q, cb) => cb([{ id: 1, url: tabUrl }])),
      sendMessage: sendMessageMock
    }
  };
  require('../popup.js');
}

function resetChromeState() {
  lastError = null;
  tabUrl = 'https://www.linkedin.com/search/results/people/';
  responses = { STATUS: { connected: 0, skipped: 0, running: false, total: 0 } };
  storageSetMock = jest.fn((_obj, cb) => { if (typeof cb === 'function') cb(); });
  sendMessageMock = jest.fn((_tabId, msg, cb) => {
    chrome.runtime.lastError = lastError;
    if (cb) cb(responses[msg.type]);
    chrome.runtime.lastError = null;
  });
}

beforeEach(() => {
  resetChromeState();
  loadPopup();
});

const byId = id => document.getElementById(id);
const fireChange = id => byId(id).dispatchEvent(new Event('change', { bubbles: true }));
const sentTypes = () => sendMessageMock.mock.calls.map(c => c[1].type);
// jsdom never fires clicks on disabled buttons — mirror the real flow of
// scanning first (which enables Start) before clicking Start/Stop.
const scanThenStart = () => {
  responses.SCAN = { count: 4 };
  byId('btn-search').click();
  expect(byId('btn-start').disabled).toBe(false);
};

// ---------------------------------------------------------------------------
describe('initial state', () => {
  test('start/stop disabled, search enabled, delays loaded from storage', () => {
    expect(byId('btn-start').disabled).toBe(true);
    expect(byId('btn-stop').disabled).toBe(true);
    expect(byId('btn-search').disabled).toBe(false);
    expect(byId('delay-min').value).toBe('1500');
    expect(byId('delay-max').value).toBe('3000');
    expect(byId('status-text').textContent).toBe('Idle — open LinkedIn search page');
    expect(byId('status-dot').className).toBe('');
  });

  test('pings STATUS on open', () => {
    expect(sentTypes()).toContain('STATUS');
  });
});

describe('STATUS → updateUI', () => {
  test('running=true → pulsing active dot, Running… text, counters filled', () => {
    responses.STATUS = { connected: 3, skipped: 2, running: true, total: 5 };
    loadPopup(); // reload so the STATUS callback uses the new response
    expect(byId('status-dot').classList.contains('active')).toBe(true);
    expect(byId('status-text').textContent).toBe('Running…');
    expect(byId('count-ok').textContent).toBe('3');
    expect(byId('count-skip').textContent).toBe('2');
  });

  test('running=false → idle text, no dot class', () => {
    responses.STATUS = { connected: 0, skipped: 0, running: false, total: 0 };
    loadPopup();
    expect(byId('status-dot').className).toBe('');
    expect(byId('status-text').textContent).toBe('Idle — open LinkedIn search page');
  });
});

describe('SCAN', () => {
  test('buttons found → enables Start, logs count, refreshes STATUS', () => {
    responses.SCAN = { count: 4 };
    byId('btn-search').click();
    expect(byId('btn-start').disabled).toBe(false);
    expect(byId('log').textContent).toContain('Found 4');
    const types = sentTypes();
    expect(types.indexOf('SCAN')).toBeGreaterThan(-1);
    // initial STATUS ping is at index 0; the post-scan refresh must come after SCAN
    expect(types.lastIndexOf('STATUS')).toBeGreaterThan(types.indexOf('SCAN'));
  });

  test('no buttons → Start stays disabled', () => {
    responses.SCAN = { count: 0 };
    byId('btn-search').click();
    expect(byId('btn-start').disabled).toBe(true);
    expect(byId('log').textContent).toBe('🔍 No Connect buttons found.');
  });
});

describe('START / STOP state machine', () => {
  test('START ok → locks search, unlocks stop, active dot', () => {
    responses.START = { ok: true };
    scanThenStart();
    byId('btn-start').click();
    expect(byId('btn-start').disabled).toBe(true);
    expect(byId('btn-search').disabled).toBe(true);
    expect(byId('btn-stop').disabled).toBe(false);
    expect(byId('status-dot').classList.contains('active')).toBe(true);
    expect(byId('status-text').textContent).toBe('Connecting…');
    expect(byId('log').textContent).toBe('▶ Connecting...');
  });

  test('START rejected (queue empty at content script) → error dot + warning', () => {
    responses.START = { ok: false };
    scanThenStart(); // popup thinks there are buttons, but content script has an empty queue
    byId('btn-start').click();
    expect(byId('status-dot').classList.contains('error')).toBe(true);
    expect(byId('log').textContent).toBe('⚠ Click Search first to find buttons.');
  });

  test('STOP → re-enables search, keeps Start enabled per lastScanCount, idle dot', () => {
    responses.START = { ok: true };
    scanThenStart();
    byId('btn-start').click();
    byId('btn-stop').click();
    expect(byId('btn-search').disabled).toBe(false);
    expect(byId('btn-start').disabled).toBe(false); // a scan happened earlier
    expect(byId('btn-stop').disabled).toBe(true);
    expect(byId('status-dot').className).toBe('');
    expect(byId('status-text').textContent).toBe('Idle — open LinkedIn search page');
    expect(byId('log').textContent).toBe('⏹ Stopped.');
  });


});

describe('RESET', () => {
  test('clears counters, dot, status text, log; restores buttons', () => {
    responses.STATUS = { connected: 9, skipped: 7, running: true, total: 16 };
    loadPopup();
    responses.SCAN = { count: 4 };
    responses.START = { ok: true };
    byId('btn-search').click();
    byId('btn-start').click();

    byId('btn-reset').click();
    expect(byId('count-ok').textContent).toBe('0');
    expect(byId('count-skip').textContent).toBe('0');
    expect(byId('status-dot').className).toBe('');
    expect(byId('status-text').textContent).toBe('');
    expect(byId('log').textContent).toBe('↺ Reset.');
    expect(byId('btn-search').disabled).toBe(false);
    expect(byId('btn-start').disabled).toBe(false); // lastScanCount still 4
    expect(byId('btn-stop').disabled).toBe(true);
  });
});

describe('delay validation (saveDelay)', () => {
  test('min > max → invalid class on both inputs + warning', () => {
    byId('delay-min').value = '5000';
    byId('delay-max').value = '1000';
    fireChange('delay-min');
    expect(byId('delay-min').classList.contains('invalid')).toBe(true);
    expect(byId('delay-max').classList.contains('invalid')).toBe(true);
    expect(byId('log').textContent).toBe(WARNING);
    expect(storageSetMock).not.toHaveBeenCalled();
  });

  test('min < 500 → invalid', () => {
    byId('delay-min').value = '100';
    byId('delay-max').value = '2000';
    fireChange('delay-min');
    expect(byId('delay-min').classList.contains('invalid')).toBe(true);
    expect(byId('log').textContent).toBe(WARNING);
  });

  test('valid range → saved, invalid classes cleared, warning cleared', () => {
    // trigger an error first so we can assert it gets cleared
    byId('delay-min').value = '5000';
    byId('delay-max').value = '1000';
    fireChange('delay-min');
    expect(byId('log').textContent).toBe(WARNING);

    byId('delay-min').value = '1000';
    byId('delay-max').value = '2000';
    fireChange('delay-max');
    expect(byId('delay-min').classList.contains('invalid')).toBe(false);
    expect(byId('delay-max').classList.contains('invalid')).toBe(false);
    expect(byId('log').textContent).toBe('');
    expect(storageSetMock).toHaveBeenCalledWith({ delayMin: 1000, delayMax: 2000 });
  });
});

describe('send() error paths', () => {
  test('on LinkedIn but content script not injected → reload hint + error dot', () => {
    lastError = { message: 'Receiving end does not exist' };
    loadPopup();
    expect(byId('log').textContent).toBe('⚠ Reload the page (F5) to activate extension.');
    expect(byId('status-dot').classList.contains('error')).toBe(true);
  });

  test('not on LinkedIn → navigate hint + error dot', () => {
    lastError = { message: 'Receiving end does not exist' };
    tabUrl = 'https://example.com/';
    loadPopup();
    expect(byId('log').textContent).toBe('⚠ Not on LinkedIn. Open a search page.');
    expect(byId('status-dot').classList.contains('error')).toBe(true);
  });

  test('no active tab → "No active tab"', () => {
    global.chrome.tabs.query = jest.fn((_q, cb) => cb([]));
    document.body.innerHTML = BODY_HTML;
    jest.resetModules();
    require('../popup.js');
    expect(byId('log').textContent).toBe('⚠ No active tab');
  });
});
