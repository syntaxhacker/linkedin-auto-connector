'use strict';

/**
 * background.js LLM_FETCH relay — drives the REAL worker file (not a mock)
 * with a stubbed chrome + fetch, end to end: message in, raw text out.
 */

describe('background LLM_FETCH relay', () => {
  let realChrome;
  let realFetch;
  let listeners;

  beforeEach(() => {
    jest.resetModules();
    realChrome = global.chrome;
    realFetch = global.fetch;
    listeners = [];
    global.chrome = {
      contextMenus: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      runtime: {
        id: 'test-ext-id',
        onMessage: { addListener: jest.fn(l => listeners.push(l)) },
        onInstalled: { addListener: jest.fn() },
        onStartup: { addListener: jest.fn() },
        lastError: undefined,
      },
      permissions: {
        contains: jest.fn((_p, cb) => { cb(true); }),
      },
      tabs: { sendMessage: jest.fn() },
    };
    require('../background.js');
  });

  afterEach(() => {
    global.chrome = realChrome;
    global.fetch = realFetch;
  });

  function llmListener() {
    const sender = { id: 'test-ext-id', url: 'https://www.linkedin.com/feed/' };
    const l = listeners.find(fn => {
      try { return fn({ type: 'LLM_FETCH', url: 'u', headers: {}, body: '{}', timeoutMs: 1000 }, sender, () => {}) === true; }
      catch (_) { return false; }
    });
    return l;
  }
  function callLlm(payload) {
    const sender = { id: 'test-ext-id', url: 'https://www.linkedin.com/feed/' };
    return new Promise(resolve => {
      llmListener()(Object.assign({ type: 'LLM_FETCH', timeoutMs: 1000 }, payload), sender, resolve);
    });
  }

  test('relays the POST and returns raw text + status', async () => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, text: () => Promise.resolve('{"answers":{"c0":{"choice":"relevant"}}}'),
    }));
    expect(llmListener()).toBeDefined();
    const resp = await callLlm({ url: 'https://api.typesafe.ai/v1/systemone', headers: { Authorization: 'Bearer k' }, body: '{}' });
    expect(resp.ok).toBe(true);
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.text).answers.c0.choice).toBe('relevant');
    const calls = global.fetch.mock.calls;
    const [url, opts] = calls[calls.length - 1];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(opts.headers.Authorization).toBe('Bearer k');
  });

  test('non-OK responses pass through (caller maps to kill-switch)', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('{}') }));
    const resp = await callLlm({ url: 'https://x.test/', headers: {}, body: '{}' });
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(401);
  });

  test('network failure resolves with text field (never hangs the sender)', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    const resp = await callLlm({ url: 'https://x.test/', headers: {}, body: '{}' });
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(0);
    expect(typeof resp.text).toBe('string');
    expect(resp.error).toMatch(/down/);
  });

  test('ignores unrelated messages', () => {
    const other = listeners.find(fn => {
      try { return fn({ type: 'NOPE' }, {}, () => {}) === false; }
      catch (_) { return false; }
    });
    expect(other).toBeDefined();
  });

  test('forbidden sender is refused', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }));
    const resp = await new Promise(resolve => {
      llmListener()({ type: 'LLM_FETCH', url: 'https://x.test/', headers: {}, body: '{}' }, { id: 'other-ext' }, resolve);
    });
    expect(resp.error).toBe('forbidden sender');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('non-https and oversize bodies are refused without fetch', async () => {
    global.fetch = jest.fn();
    const bad = await callLlm({ url: 'http://x.test/', headers: {}, body: '{}' });
    expect(bad.error).toBe('https only');
    const big = await callLlm({ url: 'https://x.test/', headers: {}, body: 'x'.repeat(257 * 1024) });
    expect(big.error).toBe('body too large');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('ungranted custom host is refused before fetch', async () => {
    global.chrome.permissions.contains = jest.fn((_p, cb) => cb(false));
    global.fetch = jest.fn();
    const resp = await callLlm({ url: 'https://attacker.test/v1/x', headers: {}, body: '{}' });
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/host permission not granted/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('the default API host needs no extra permission', async () => {
    global.chrome.permissions.contains = jest.fn(() => { throw new Error('must not check default host'); });
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }));
    const resp = await callLlm({ url: 'https://api.typesafe.ai/v1/systemone', headers: {}, body: '{}' });
    expect(resp.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('popup sender (no tab, own id) is allowed', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }));
    const resp = await new Promise(resolve => {
      llmListener()({ type: 'LLM_FETCH', url: 'https://x.test/', headers: {}, body: '{}' }, { id: 'test-ext-id' }, resolve);
    });
    expect(resp.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('oversize streamed response is truncated, not buffered whole', async () => {
    // TextDecoder is guaranteed in Chrome workers but missing in this jsdom
    // env — supply Node's for the test.
    const realTD = global.TextDecoder;
    try { global.TextDecoder = require('util').TextDecoder; } catch (_) {}
    const chunk = new Uint8Array(1024 * 1024).fill(65); // 1MB of 'A'
    let reads = 0;
    const reader = { read: jest.fn(() => (++reads <= 3 ? Promise.resolve({ done: false, value: chunk }) : Promise.resolve({ done: true, value: undefined }))), cancel: jest.fn(() => Promise.resolve()) };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, body: { getReader: () => reader } }));
    try {
      const resp = await callLlm({ url: 'https://x.test/', headers: {}, body: '{}' });
      expect(resp.ok).toBe(true);
      expect(resp.text.length).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(resp.truncated).toBe(true);
      expect(reader.cancel).toHaveBeenCalled();
    } finally {
      if (realTD === undefined) delete global.TextDecoder;
      else global.TextDecoder = realTD;
    }
  });
});
