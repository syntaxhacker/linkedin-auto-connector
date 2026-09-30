'use strict';

/**
 * LLM guardrails — spend safety for auto-on-scan classification:
 * in-flight guard, per-minute throttle, daily cap, kill-switch, estimator.
 */

const { makePost, closePanels, sendMessage } = require('./helpers');

function okFetch(choice, confidence) {
  const body = { answers: { c0: { choice, confidence, probabilities: {} } } };
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  );
}

describe('llm guardrails', () => {
  let realFetch;

  beforeEach(() => {
    document.body.innerHTML = '';
    realFetch = global.fetch;
    global.__LI.setCfg({
      includeKeywords: ['react'], excludeKeywords: [], jevPrompt: '',
      jevMinConfidence: 0.7, llmProviderId: 'jev',
      llmCategories: null,
      jevCategories: [
        { id: 'relevant', label: 'relevant', criteria: '', action: 'expand' },
        { id: 'excluded', label: 'excluded', criteria: '', action: 'collapse' },
        { id: 'other', label: 'other', criteria: '', action: 'collapse' },
      ],
      llmEndpoints: {}, llmModels: {},
      llmDailyCapPosts: 500, llmPerMinReq: 60, llmMinRunGapMs: 0,
    });
    global.__LI.resetLlmSession();
    global.__LI.resetLlmDaily();
    global.__LI.jevReset();
    global.__LI.clearJevCache();
    global.__LI.setJevApiKey('test-key-123');
  });

  afterEach(() => {
    global.fetch = realFetch;
    global.__LI.setJevApiKey('');
    global.__LI.resetLlmSession();
    global.__LI.jevReset();
  });

  test('back-to-back runs are paced with a scheduled follow-up', async () => {
    global.__LI.setCfg({ llmMinRunGapMs: 3000 });
    global.fetch = okFetch('relevant', 0.9);
    const first = await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    expect(first.status).toBe('ok');
    const second = await global.__LI.llmClassifyPosts([makePost('React post beta with body text')]);
    expect(second.status).toBe('paced');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    global.__LI.cleanup(); // clear the scheduled follow-up scan
  });

  test('second overlapping call returns busy without a second fetch', async () => {
    let resolveFetch;
    global.fetch = jest.fn(() => new Promise(res => { resolveFetch = res; }));
    const post = makePost('React post one with body text here');
    const p1 = global.__LI.llmClassifyPosts([post]);
    const p2res = await global.__LI.llmClassifyPosts([makePost('React post two with body text here')]);
    expect(p2res.status).toBe('busy');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }) });
    const p1res = await p1;
    expect(p1res.status).toBe('ok');
  });

  // Enforcement tests follow the flag so re-enabling limits can't ship untested.
  const describeLimits = global.__LI.LLM_LIMITS_ENABLED === false ? describe.skip : describe;
  describeLimits('llm limits (enforced only when LLM_LIMITS_ENABLED)', () => {
    test('daily cap blocks after the limit and reports capped', async () => {
    global.__LI.setCfg({ llmDailyCapPosts: 1 });
    global.fetch = okFetch('relevant', 0.9);
    const first = await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    expect(first.status).toBe('ok');
    const second = await global.__LI.llmClassifyPosts([makePost('React post beta with body text')]);
    expect(second.status).toBe('capped');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // Limits disabled for now (LLM_LIMITS_ENABLED=false) — kept for re-enable.
  test('per-minute throttle blocks rapid successive scans', async () => {
    global.__LI.setCfg({ llmPerMinReq: 1 });
    global.fetch = okFetch('relevant', 0.9);
    await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    const res = await global.__LI.llmClassifyPosts([makePost('React post beta with body text')]);
    expect(res.status).toBe('throttled');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  });

  test('401 kills auto-classify until retry is cleared', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }));
    const post = makePost('React post alpha with body text');
    const res = await global.__LI.llmClassifyPosts([post]);
    expect(res.status).toBe('error');
    const stats = global.__LI.getLlmStats();
    expect(stats.killed).toBe(true);
    global.fetch = okFetch('relevant', 0.9);
    const blocked = await global.__LI.llmClassifyPosts([makePost('React post beta with body text')]);
    expect(blocked.status).toBe('killed');
    global.__LI.clearLlmKill();
    const retry = await global.__LI.llmClassifyPosts([makePost('React post gamma with body text')]);
    expect(retry.status).toBe('ok');
  });

  test('stats track session requests/posts and estimated cost', async () => {
    global.fetch = okFetch('relevant', 0.9);
    await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    const stats = global.__LI.getLlmStats();
    expect(stats.sessionReq).toBe(1);
    expect(stats.sessionPosts).toBe(1);
    expect(stats.estimatedCost).toBeGreaterThan(0);
    expect(typeof stats.estimatedCost).toBe('number');
  });

  test('migrateLegacyLlmKeys moves jevApiKey into llmKeys without loss', () => {
    const out = global.__LI.migrateLegacyLlmKeys({ jevApiKey: 'old-key' }, {});
    expect(out).toEqual({ jev: 'old-key' });
    expect(global.__LI.migrateLegacyLlmKeys({}, { jev: 'keep' })).toEqual({ jev: 'keep' });
    expect(global.__LI.migrateLegacyLlmKeys({}, {})).toEqual({});
  });

  test('handleLlmLocalLoad migrates, writes back, and drops the legacy key', () => {
    const setMock = global.chrome.storage.local.set;
    const removeMock = global.chrome.storage.local.remove;
    setMock.mockClear();
    removeMock.mockClear();
    const keys = global.__LI.handleLlmLocalLoad({ jevApiKey: 'old-key', llmKeys: {}, llmDaily: null });
    expect(keys).toEqual({ jev: 'old-key' });
    expect(setMock).toHaveBeenCalledWith({ llmKeys: { jev: 'old-key' } });
    expect(removeMock).toHaveBeenCalledWith('jevApiKey');
    // no legacy key → no remove call
    removeMock.mockClear();
    global.__LI.handleLlmLocalLoad({ llmKeys: { jev: 'k' } });
    expect(removeMock).not.toHaveBeenCalled();
  });

  test('429, then non-429, then 429 does NOT kill (chain broken)', async () => {
    const post = () => makePost('React post with enough body text here ' + Math.random());
    global.fetch = jest.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }));
    await global.__LI.llmClassifyPosts([post()]);
    await global.__LI.llmClassifyPosts([post()]);
    await global.__LI.llmClassifyPosts([post()]);
    expect(global.__LI.getLlmStats().killed).toBe(false);
  });

  test('429 twice in a row kills', async () => {
    const post = () => makePost('React post with enough body text here ' + Math.random());
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }));
    await global.__LI.llmClassifyPosts([post()]);
    await global.__LI.llmClassifyPosts([post()]);
    expect(global.__LI.getLlmStats().killed).toBe(true);
  });

  test('mid-loop failure still accounts completed batches', async () => {
    const posts = [];
    for (let i = 0; i < 25; i++) posts.push(makePost('React post number ' + i + ' with enough body text to classify'));
    const answers = {};
    for (let i = 0; i < 20; i++) answers['c' + i] = { choice: 'relevant', confidence: 0.9, probabilities: {} };
    global.fetch = jest.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ answers }) }))
      .mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const res = await global.__LI.llmClassifyPosts(posts);
    expect(res.status).toBe('error');
    expect(res.count).toBe(20);
    const stats = global.__LI.getLlmStats();
    expect(stats.sessionReq).toBe(1);
    expect(stats.sessionPosts).toBe(20);
  });

  test('prototype-named choice (constructor) falls back to unsure', async () => {
    const post = makePost('React post with enough body text here');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ answers: { c0: { choice: 'constructor', confidence: 0.99, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([post]);
    expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('unsure');
  });

  test('custom-endpoint refusal surfaces the worker error and releases in-flight', async () => {
    global.__LI.setCfg({ llmEndpoints: { jev: 'https://example.com/v1/systemone' } });
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    // Worker refuses the relay (no host permission) — nothing is fetched.
    global.chrome.runtime.sendMessage = jest.fn((_m, cb) => cb({ ok: false, status: 0, text: '', error: 'host permission not granted for https://example.com' }));
    global.fetch = jest.fn();
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('error');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
      // The worker's refusal reason must actually surface (not a generic error)
      await expect(global.__LI.llmPost('https://example.com/v1/systemone', {}, '{}', 1000))
        .rejects.toThrow(/host permission not granted/);
      // not stuck: a granted relay succeeds afterwards
      global.chrome.runtime.sendMessage = jest.fn((_m, cb) => cb({ ok: true, status: 200, text: JSON.stringify({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }) }));
      const retry = await global.__LI.llmClassifyPosts([post]);
      expect(retry.status).toBe('ok');
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('relayed HTTP error surfaces the API body snippet', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((_msg, cb) => cb({ ok: false, status: 400, text: '{"detail":"question c0 too long"}' }));
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('error');
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('relay that never calls back times out and clears in-flight', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(() => { /* never calls back */ });
    global.fetch = jest.fn(() => { throw new Error('must not fetch directly'); });
    try {
      // llmPost caps the relay round-trip at timeoutMs + 5s buffer.
      await expect(global.__LI.llmPost('https://api.typesafe.ai/v1/systemone', {}, '{}', 250))
        .rejects.toThrow(/worker not answering|timed out/i);
      // in-flight released: orchestration still works afterwards
      global.chrome.runtime.sendMessage = jest.fn((_m, cb) => cb({ ok: true, status: 200, text: JSON.stringify({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }) }));
      const retry = await global.__LI.llmClassifyPosts([post]);
      expect(retry.status).toBe('ok');
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  }, 15000);

  test('relay path uses background response and skips direct fetch', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      expect(msg.type).toBe('LLM_FETCH');
      expect(msg.url).toBe(global.__LI.JEV_API_URL);
      expect(msg.headers.Authorization).toBe('Bearer test-key-123');
      cb({ ok: true, status: 200, text: JSON.stringify({ answers: { c0: { choice: 'relevant', confidence: 0.91, probabilities: {} } } }) });
    });
    global.fetch = jest.fn(() => { throw new Error('must not fetch directly'); });
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('ok');
      expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('relay no-answer surfaces worker cause instead of CORS fallback', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((_msg, cb) => {
      global.chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
      cb(undefined);
    });
    global.fetch = jest.fn(() => { throw new Error('must not fetch directly'); });
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('error');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
    } finally {
      delete global.chrome.runtime.lastError;
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('relayed network error is distinct from worker-missing', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((_msg, cb) => cb({ ok: false, status: 0, text: '', error: 'socket hangup' }));
    global.fetch = jest.fn(() => { throw new Error('must not fetch directly'); });
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('error');
      expect(global.fetch).not.toHaveBeenCalled();
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('relay garbage JSON errors and leaves posts retryable', async () => {
    const post = makePost('React post with enough body text here');
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((_msg, cb) => cb({ ok: true, status: 200, text: '<html>not json' }));
    try {
      const res = await global.__LI.llmClassifyPosts([post]);
      expect(res.status).toBe('error');
      expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
      // not poisoned: a good response categorizes on retry
      global.chrome.runtime.sendMessage = jest.fn((_msg, cb) => cb({ ok: true, status: 200, text: JSON.stringify({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }) }));
      const retry = await global.__LI.llmClassifyPosts([post]);
      expect(retry.status).toBe('ok');
      expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('pending marker shows queued state and is replaced by verdicts', async () => {
    const post = makePost('React post with body text here');
    const done = makePost('Categorized post with body text here');
    done.setAttribute('data-jev-done', 'relevant');
    const empty = makePost(null);
    global.__LI.markJevPending([post, done, empty]);
    // Class-based marker: never a DOM child, so postKey/textContent stay clean.
    expect(post.classList.contains(global.__LI.JEV_PENDING_CLS)).toBe(true);
    expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
    // keyword-relevant text still intact (no chip text pollution)
    expect(post.textContent).toMatch(/React post/);
    expect(done.classList.contains(global.__LI.JEV_PENDING_CLS)).toBe(false);
    expect(empty.classList.contains(global.__LI.JEV_PENDING_CLS)).toBe(false);
    // classification clears the marker and applies a real verdict
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([post]);
    expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
    expect(post.classList.contains(global.__LI.JEV_PENDING_CLS)).toBe(false);
  });

  test('queued posts keep a stable key so they are never stranded', async () => {
    // Regression: a prepended pending chip changed textContent → postKey drift
    // → posts excluded from later scans and stuck "queued" forever.
    const post = makePost('React post with body text here unique-1');
    global.__LI.markJevPending([post]);
    const keyWhilePending = global.__LI.postKey(post);
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([post]);
    expect(post.getAttribute('data-jev-done')).toBe('relevant');
    // key text is unaffected by the marker/verdict chrome
    expect(keyWhilePending).toMatch(/React post/);
  });

  test('non-relevant posts collapse to a thin strip, never display:none', async () => {
    const exc = makePost('Intern post with body text here');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'excluded', confidence: 0.9, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([exc]);
    expect(exc.classList.contains('li-ac-jev-concealed')).toBe(true);
    // CSS must collapse, not remove: layout stays native for LinkedIn's list.
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
    expect(css).toMatch(/\.li-ac-jev-concealed[^}]*max-height/);
    expect(css).not.toMatch(/\.li-ac-jev-concealed[^}]*display:\s*none/);
    // pending marker is still class-only
    global.__LI.jevReset();
    expect(exc.classList.contains('li-ac-jev-concealed')).toBe(false);
  });

  test('postKey keeps non-P content distinct (no truncation collisions)', () => {
    const build = extra => {
      const d = document.createElement('div');
      d.innerHTML = '<h2>Feed post</h2> <p>Check this out</p><span>' + extra + '</span>';
      return d;
    };
    const a = build('Shared article: React at scale');
    const b = build('Document: Hiring rubric 2026');
    expect(global.__LI.postKey(a)).not.toBe(global.__LI.postKey(b));
  });

  test('legacy keys survive an injected verdict chip', () => {
    const post = makePost('legacy body text for migration check');
    const before = global.__LI.postKey(post);
    const legacyBefore = ((post.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    global.__LI.applyJevChip(post, 'relevant', 0.9);
    expect(post.querySelector('.li-ac-jev-chip')).not.toBeNull();
    // new-style key unaffected by the chip
    expect(global.__LI.postKey(post)).toBe(before);
    // legacy compatibility: pre-chip 80-char text still resolves via migration
    global.__LI.dismissedKeys().add('kw:' + legacyBefore);
    expect(global.__LI.sortedHits('kw').some(h => h.key === before)).toBe(false);
    global.__LI.dismissedKeys().clear();
  });

  test('postKey disambiguates same-author posts (no shared-prefix collisions)', () => {
    const a = makePost('Hiring React devs, apply now. contact us today');
    const b = makePost('Hiring React devs, but a totally different body sentence');
    // same author href on both, different bodies
    const linkA = document.createElement('a'); linkA.href = 'https://www.linkedin.com/in/same-author/';
    a.appendChild(linkA);
    const linkB = document.createElement('a'); linkB.href = 'https://www.linkedin.com/in/same-author/';
    b.appendChild(linkB);
    expect(global.__LI.postKey(a)).not.toBe(global.__LI.postKey(b));
    expect(global.__LI.postKey(a)).toMatch(/same-author/);
  });

  test('detached mid-flight posts are skipped and retryable, not poisoned', async () => {
    const staying = makePost('React staying post with body text here');
    const leaving = makePost('React leaving post with body text here');
    let resolveFetch;
    global.fetch = jest.fn(() => new Promise(res => { resolveFetch = res; }));
    const p = global.__LI.llmClassifyPosts([staying, leaving]);
    await new Promise(r => setTimeout(r, 0)); // let the gate + permission check run
    leaving.remove(); // LinkedIn virtualizes the node away mid-request
    resolveFetch({ ok: true, json: () => Promise.resolve({ answers: {
      c0: { choice: 'relevant', confidence: 0.9, probabilities: {} },
      c1: { choice: 'relevant', confidence: 0.9, probabilities: {} },
    } }) });
    const res = await p;
    expect(res.status).toBe('ok');
    expect(res.count).toBe(1); // only the connected post counts
    expect(staying.querySelector('.li-ac-jev-chip')).not.toBeNull();
    // re-attached node is NOT poisoned: it categorizes on retry
    document.body.appendChild(leaving);
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'other', confidence: 0.8, probabilities: {} } } }),
    }));
    const retry = await global.__LI.llmClassifyPosts([leaving]);
    expect(retry.count).toBe(1);
    expect(leaving.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('other');
  });

  test('resolveJevCategory allowlists choices; low confidence is flagged, not discarded', () => {
    const cats = { relevant: 'r', excluded: 'e', other: 'o' };
    expect(global.__LI.resolveJevCategory({ choice: 'relevant', confidence: 0.9 }, cats, 0.7))
      .toEqual({ cat: 'relevant', conf: 0.9, lowConfidence: false });
    expect(global.__LI.resolveJevCategory({ choice: 'relevant', confidence: 0.3 }, cats, 0.7))
      .toEqual({ cat: 'relevant', conf: 0.3, lowConfidence: true });
    expect(global.__LI.resolveJevCategory({ choice: 'constructor', confidence: 0.99 }, cats, 0.7))
      .toEqual({ cat: 'unsure', conf: 0, lowConfidence: false });
    expect(global.__LI.resolveJevCategory(null, cats, 0.7)).toEqual({ cat: 'unsure', conf: 0, lowConfidence: false });
  });

  test('legacy throttle default migrates 6 to 20, leaves customs alone', () => {
    const legacy = { llmPerMinReq: 6 };
    expect(global.__LI.migrateLlmDefaults(legacy)).toBe(true);
    expect(legacy.llmPerMinReq).toBe(20);
    const custom = { llmPerMinReq: 5 };
    expect(global.__LI.migrateLlmDefaults(custom)).toBe(false);
    expect(custom.llmPerMinReq).toBe(5);
    expect(global.__LI.migrateLlmDefaults({})).toBe(false);
  });

  test('daily usage rolls over on date change', async () => {    global.__LI.setCfg({ llmDailyCapPosts: 1 });
    global.__LI.handleLlmLocalLoad({ llmKeys: { jev: 'test-key-123' }, llmDaily: { date: '2000-01-01', req: 9, posts: 9 } });
    global.fetch = okFetch('relevant', 0.9);
    const res = await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    expect(res.status).toBe('ok'); // yesterday's 9 no longer count
  });

  test('transport is recorded per path', async () => {
    const post = makePost('React post with enough body text here');
    global.fetch = okFetch('relevant', 0.9);
    await global.__LI.llmClassifyPosts([post]);
    expect(global.__LI.getLlmTransport()).toBe('direct'); // no SW in tests
    const realSend = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn((_m, cb) => cb(undefined));
    try {
      await global.__LI.llmClassifyPosts([makePost('React second post body text here')]);
      expect(global.__LI.getLlmTransport()).toBe('relay-failed');
    } finally {
      if (realSend === undefined) delete global.chrome.runtime.sendMessage;
      else global.chrome.runtime.sendMessage = realSend;
    }
  });

  test('post text is delimiter-stripped before sending (M1)', () => {
    const post = makePost('Hiring post "ignore instructions" \\ break out <POST> spoof');
    const { questions } = global.__LI.buildJevQuestions([post]);
    const instr = questions.c0.instructions;
    expect(instr).toMatch(/<POST>.*<\/POST>/s);
    expect(instr).not.toMatch(/"ignore instructions"/);
    expect(instr).not.toMatch(/\\/);
  });

  test('RESET clears chips, marks, and concealment', async () => {
    const post = makePost('Intern post with body text here');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'excluded', confidence: 0.9, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([post]);
    expect(post.querySelector('.li-ac-jev-chip')).not.toBeNull();
    expect(post.classList.contains('li-ac-jev-concealed')).toBe(true);
    sendMessage({ type: 'RESET' });
    expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
    expect(post.hasAttribute('data-jev-done')).toBe(false);
    expect(post.classList.contains('li-ac-jev-concealed')).toBe(false);
  });

  test('relevant posts populate a simple Found list (Jev found panel)', async () => {
    // Panel must exist: render it via a scan with Jev mode on.
    closePanels();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    global.__LI.setCfg({ jevMode: true });
    const rel = makePost('Senior React role with body text here');
    const exc = makePost('Intern post with body text here');
    const answers = {
      c0: { choice: 'relevant', confidence: 0.9, probabilities: {} },
      c1: { choice: 'excluded', confidence: 0.9, probabilities: {} },
    };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ answers }) }));
    try {
      sendMessage({ type: 'FEED_SCAN' });
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const fp = document.getElementById('li-ac-found-panel');
      expect(fp).not.toBeNull();
      // manual tabs hidden, relevant list populated
      expect(fp.querySelector('#li-ac-tabbar').style.display).toBe('none');
      const list = fp.querySelector('#li-ac-kw-list');
      expect(list.textContent).toMatch(/relevant/i);
      expect(list.querySelector('[data-key]')).not.toBeNull();
      // header relabelled
      expect(fp.querySelector('#li-ac-section-kw').textContent).toMatch(/Relevant posts/i);
      // excluded post is not listed
      const rows = list.querySelectorAll('[data-key]');
      expect(rows.length).toBe(1);
    } finally {
      global.fetch = realFetch;
      jest.useRealTimers();
      global.__LI.setCfg({ jevMode: false });
      closePanels();
    }
  });

  test('relevant list survives scans that skip classification', async () => {
    closePanels();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    global.__LI.setCfg({ jevMode: true, llmMinRunGapMs: 0 });
    global.__LI.jevReset();
    const rel = makePost('Senior React role with body text here');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    try {
      sendMessage({ type: 'FEED_SCAN' });
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const fp = document.getElementById('li-ac-found-panel');
      expect(fp.querySelectorAll('#li-ac-kw-list [data-key]').length).toBe(1);

      // Now remove the API key: classification is skipped, but the panel must
      // NOT blank out (regression: renderPanel cleared kwPanelData first).
      global.__LI.setLlmKey('jev', '');
      sendMessage({ type: 'FEED_SCAN' });
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const fp2 = document.getElementById('li-ac-found-panel');
      expect(fp2.querySelectorAll('#li-ac-kw-list [data-key]').length).toBe(1);
      expect(fp2.querySelector('#li-ac-tabbar').style.display).toBe('none');
    } finally {
      global.fetch = realFetch;
      jest.useRealTimers();
      global.__LI.setJevApiKey('');
      global.__LI.setCfg({ jevMode: false });
      global.__LI.jevReset();
      closePanels();
    }
  });

  test('cost line reports today usage as well as the session', async () => {
    closePanels();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    global.__LI.setCfg({ jevMode: true });
    const rel = makePost('Senior React role with body text here');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    try {
      sendMessage({ type: 'FEED_SCAN' });
      await jest.advanceTimersByTimeAsync(500);
      await Promise.resolve();
      const cost = document.getElementById('li-ac-llm-cost');
      expect(cost.textContent).toMatch(/Est\./);
      expect(cost.textContent).toMatch(/today 1/);
    } finally {
      global.fetch = realFetch;
      jest.useRealTimers();
      global.__LI.setCfg({ jevMode: false });
      closePanels();
    }
  });

  test('cached verdicts are reused instead of calling the API again', async () => {
    closePanels();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    global.__LI.setCfg({ jevMode: true, llmMinRunGapMs: 0 });
    const post = makePost('Same post that shows up in another search entirely');
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } } }),
    }));
    try {
      await global.__LI.llmClassifyPosts([post]);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Simulate a fresh page/tab: new node, same post content, no session memos.
      post.remove();
      global.__LI.jevReset();
      const again = makePost('Same post that shows up in another search entirely');
      // cache survived jevReset (only RESET clears it)
      const applied = global.__LI.applyJevCacheToPosts([again]);
      expect(applied).toBe(1);
      const chip = again.querySelector('.li-ac-jev-chip');
      expect(chip.getAttribute('data-jev-category')).toBe('relevant');
      // nothing left to classify → no further API call
      const res = await global.__LI.llmClassifyPosts([again]);
      expect(res.count).toBe(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = realFetch;
      jest.useRealTimers();
      global.__LI.clearJevCache();
      global.__LI.setCfg({ jevMode: false });
      closePanels();
    }
  });

  test('cache ignores verdicts for categories that no longer exist', async () => {
    global.__LI.setCfg({ jevCategories: [{ id: 'relevant', label: 'relevant', criteria: '', action: 'expand' }] });
    global.__LI.jevCacheRemember('k1', 'deleted-bucket', 0.9);
    expect(global.__LI.jevCacheGet('k1')).toBeNull();
    global.__LI.jevCacheRemember('k2', 'relevant', 0.9);
    expect(global.__LI.jevCacheGet('k2').cat).toBe('relevant');
    // unsure is never cached (worth retrying)
    global.__LI.jevCacheRemember('k3', 'unsure', 0.1);
    expect(global.__LI.jevCacheGet('k3')).toBeNull();
  });

  test('empty input returns ok without fetch', async () => {
    global.fetch = okFetch('relevant', 0.9);
    const res = await global.__LI.llmClassifyPosts([]);
    expect(res).toEqual({ status: 'ok', count: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('resetLlmDaily zeroes counters and persists', async () => {
    global.fetch = okFetch('relevant', 0.9);
    await global.__LI.llmClassifyPosts([makePost('React post alpha with body text')]);
    const setMock = global.chrome.storage.local.set;
    setMock.mockClear();
    global.__LI.resetLlmDaily();
    expect(setMock).toHaveBeenCalledWith({ llmDaily: expect.objectContaining({ req: 0, posts: 0 }) });
    const retry = await global.__LI.llmClassifyPosts([makePost('React post beta with body text')]);
    expect(retry.status).toBe('ok');
  });

  test('openai-compat dispatches through the orchestrator and chips posts', async () => {
    global.__LI.setCfg({ llmProviderId: 'openai-compat' });
    global.__LI.setLlmKey('openai-compat', 'test-key-not-real');
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: JSON.stringify({ results: [{ id: 'c0', category: 'excluded', confidence: 0.85 }] }) } }] }),
      })
    );
    const post = makePost('Intern post with body text here');
    const res = await global.__LI.llmClassifyPosts([post]);
    expect(res.status).toBe('ok');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(opts.headers.Authorization).toBe('Bearer test-key-not-real');
    expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('excluded');
    expect(post.classList.contains('li-ac-jev-concealed')).toBe(true);
  });

  test('relevant posts stay visible; concealed count tracks non-matches', async () => {
    const rel = makePost('React post with body text here');
    const exc = makePost('Intern post with body text here');
    const uns = makePost('Vague post with body text here');
    const oth = makePost('Cooking recipe post with body text here');
    const answers = {
      c0: { choice: 'relevant', confidence: 0.9, probabilities: {} },
      c1: { choice: 'excluded', confidence: 0.9, probabilities: {} },
      c2: { choice: 'relevant', confidence: 0.2, probabilities: {} },
      c3: { choice: 'other', confidence: 0.85, probabilities: {} },
    };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ answers }) }));
    const res = await global.__LI.llmClassifyPosts([rel, exc, uns, oth]);
    expect(res.status).toBe('ok');
    expect(rel.classList.contains('li-ac-jev-concealed')).toBe(false);
    expect(exc.classList.contains('li-ac-jev-concealed')).toBe(true);
    // low confidence keeps the bucket (flagged); the bucket's action decides
    // visibility, so an 'expand' bucket stays open
    expect(uns.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
    expect(uns.querySelector('.li-ac-jev-chip').title).toMatch(/low confidence/i);
    expect(uns.classList.contains('li-ac-jev-concealed')).toBe(false);
    // other → concealed by default as well
    expect(oth.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('other');
    expect(oth.classList.contains('li-ac-jev-concealed')).toBe(true);
    expect(global.__LI.jevConcealedCount()).toBe(2);
  });

  test('full card wrapper is concealed too, no husk remains', async () => {
    const outer = document.createElement('div');
    outer.setAttribute('role', 'listitem');
    document.body.appendChild(outer);
    const post = document.createElement('div');
    outer.appendChild(post);
    const h2 = document.createElement('h2');
    h2.textContent = 'Feed post';
    post.appendChild(h2);
    post.appendChild(document.createTextNode(' '));
    const p = document.createElement('p');
    p.textContent = 'Intern post with body text here';
    post.appendChild(p);
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'excluded', confidence: 0.9, probabilities: {} } } }),
    }));
    await global.__LI.llmClassifyPosts([post]);
    expect(post.classList.contains('li-ac-jev-concealed')).toBe(true);
    expect(outer.classList.contains(global.__LI.JEV_CONCEAL_CARD_CLS)).toBe(true);
    global.__LI.jevReset();
    expect(post.classList.contains('li-ac-jev-concealed')).toBe(false);
    expect(outer.classList.contains(global.__LI.JEV_CONCEAL_CARD_CLS)).toBe(false);
  });

  test('show-hidden toggle reveals and re-hides concealed posts', async () => {
    closePanels();
    document.body.innerHTML = '';
    jest.useFakeTimers();
    makePost('React hiring post with body text here');
    sendMessage({ type: 'FEED_SCAN' });
    await jest.advanceTimersByTimeAsync(500);
    const exc = makePost('Intern post with body text here');
    const realFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ answers: { c0: { choice: 'excluded', confidence: 0.9, probabilities: {} } } }),
    }));
    try {
      await global.__LI.llmClassifyPosts([exc]);
      const btn = document.querySelector('#li-ac-jev-hidden-toggle');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toMatch(/Peek AI-collapsed \(1\)/);
      btn.click();
      expect(exc.classList.contains('li-ac-jev-concealed')).toBe(false);
      expect(btn.textContent).toMatch(/Collapse again \(1\)/);
      btn.click();
      expect(exc.classList.contains('li-ac-jev-concealed')).toBe(true);
    } finally {
      global.fetch = realFetch;
    }
    jest.useRealTimers();
    closePanels();
  });
});
