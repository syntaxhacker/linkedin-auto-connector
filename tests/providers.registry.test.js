'use strict';

/**
 * Generic LLM provider registry — Jev + OpenAI-compatible. Pipeline code
 * never branches on provider id; each entry carries buildRequest/parse.
 */

const { makePost } = require('./helpers');

describe('provider registry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['intern'], jevPrompt: '' });
    global.__LI.jevReset();
  });

  test('registry has jev + openai-compat with the required shape', () => {
    const reg = global.__LI.LLM_PROVIDERS;
    expect(Object.keys(reg).sort()).toEqual(['jev', 'openai-compat']);
    ['jev', 'openai-compat'].forEach(id => {
      const p = reg[id];
      expect(typeof p.label).toBe('string');
      expect(typeof p.defaultEndpoint).toBe('string');
      expect(typeof p.defaultModel).toBe('string');
      expect(typeof p.buildRequest).toBe('function');
      expect(typeof p.parseResponse).toBe('function');
      expect(typeof p.estimateCost).toBe('function');
    });
  });

  test('unknown provider id falls back to jev', () => {
    expect(global.__LI.getProvider('nope').id).toBe('jev');
    expect(global.__LI.getProvider('jev').id).toBe('jev');
    expect(global.__LI.getProvider('openai-compat').id).toBe('openai-compat');
  });

  test('validateEndpoint only allows https URLs', () => {
    expect(global.__LI.validateEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(global.__LI.validateEndpoint('http://evil.local/x')).toBe(false);
    expect(global.__LI.validateEndpoint('data:text/plain,hi')).toBe(false);
    expect(global.__LI.validateEndpoint('not a url')).toBe(false);
    expect(global.__LI.validateEndpoint('')).toBe(false);
  });

  test('truncatePostText caps length for sharing between providers', () => {
    expect(global.__LI.truncatePostText('x'.repeat(600), 500)).toHaveLength(500);
    expect(global.__LI.truncatePostText('  a  b\tc ', 500)).toBe('a b c');
  });

  test('truncatePostText never splits emoji or leaves lone surrogates', () => {
    // rocket straddles the 500 boundary in UTF-16 units (2 units)
    const s = 'a'.repeat(499) + '🚀' + 'b'.repeat(20);
    const out = global.__LI.truncatePostText(s, 500);
    expect(Array.from(out).length).toBeLessThanOrEqual(500);
    expect(out).toMatch(/🚀/); // intact, not a lone surrogate
    expect(out).not.toMatch(/�/);
    JSON.parse(JSON.stringify(out)); // serializes cleanly (API-safe)
    // unpaired surrogates are stripped (lead and trail)
    expect(global.__LI.truncatePostText('ab\uD800cd', 10)).toBe('ab cd');
    expect(global.__LI.truncatePostText('ab\uDC00cd', 10)).toBe('ab cd');
  });

  test('jev buildRequest matches the lib/jev.py classify shape', () => {
    const post = makePost('React hiring post');
    const cats = global.__LI.buildJevCategories();
    const req = global.__LI.getProvider('jev').buildRequest(
      [{ id: 'c0', text: 'React hiring post', key: 'k', el: post }],
      cats, 'Do the thing', 'jev-latest', ''
    );
    expect(req.url).toBe(global.__LI.JEV_API_URL);
    expect(req.headers.Authorization).toMatch(/^Bearer /);
    expect(req.body.model).toBe('jev-latest');
    expect(req.body.questions.c0.type).toBe('choice');
    expect(req.body.questions.c0.criteria).toEqual(cats);
    expect(req.body.questions.c0.instructions).toMatch(/React hiring post/);
  });

  test('openai-compat buildRequest uses JSON mode with results schema', () => {
    const prov = global.__LI.getProvider('openai-compat');
    const cats = global.__LI.buildJevCategories();
    const req = prov.buildRequest(
      [{ id: 'c0', text: 'React post', key: 'k', el: null }],
      cats, 'Do the thing', 'gpt-4o-mini', 'test-key-not-real', 'https://example.com/v1/chat/completions'
    );
    expect(req.url).toBe('https://example.com/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer test-key-not-real');
    expect(req.body.model).toBe('gpt-4o-mini');
    expect(req.body.response_format).toEqual({ type: 'json_object' });
    const sys = req.body.messages.find(m => m.role === 'system').content;
    expect(sys).toMatch(/relevant.*excluded.*other/s);
    const user = JSON.parse(req.body.messages.find(m => m.role === 'user').content);
    expect(user).toEqual([{ id: 'c0', text: 'React post' }]);
  });

  test('openai-compat parseResponse handles string content, objects, and gaps', () => {
    const prov = global.__LI.getProvider('openai-compat');
    const strContent = { choices: [{ message: { content: JSON.stringify({ results: [{ id: 'c0', category: 'relevant', confidence: 0.8 }] }) } }] };
    expect(prov.parseResponse(strContent)).toEqual([{ id: 'c0', choice: 'relevant', confidence: 0.8 }]);
    const objContent = { choices: [{ message: { content: { results: [{ id: 'c0', category: 'bogus', confidence: 'high' }] } } }] };
    expect(prov.parseResponse(objContent)).toEqual([{ id: 'c0', choice: 'unsure', confidence: 0 }]);
    expect(prov.parseResponse({})).toEqual([]);
    expect(prov.parseResponse(null)).toEqual([]);
  });
});
