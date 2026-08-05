'use strict';

/**
 * scanKeywords(posts) — returns a hit { el, keywords } for every post whose
 * text matches at least one configured INCLUDE keyword (word-boundary match).
 * Returns [] when no include keywords are configured.
 */

const { makePost } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('scanKeywords', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  test('returns posts matching include keywords with the matched keywords array', () => {
    global.__LI.setCfg({ includeKeywords: ['react', 'python'] });

    const a = makePost('React developer wanted');
    const b = makePost('Python and React both');
    const c = makePost('nothing relevant here');

    const hits = global.__LI.scanKeywords([a, b, c]);

    expect(hits).toHaveLength(2);
    expect(hits[0].el).toBe(a);
    expect(hits[0].keywords).toEqual(['react']);
    expect(hits[1].el).toBe(b);
    expect(hits[1].keywords).toEqual(['react', 'python']);
  });

  test('returns [] when no include keywords are configured', () => {
    const post = makePost('React developer wanted');
    expect(global.__LI.scanKeywords([post])).toEqual([]);
  });

  test('honors word boundaries: "reactions" is not a "react" hit', () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    const post = makePost('we hire for reactions');
    expect(global.__LI.scanKeywords([post])).toEqual([]);
  });

  test('matches every configured keyword found in a post', () => {
    global.__LI.setCfg({ includeKeywords: ['fullstack', 'remote'] });
    const post = makePost('fullstack remote role');
    const hits = global.__LI.scanKeywords([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].keywords).toEqual(['fullstack', 'remote']);
  });

  test('treats regex metacharacters literally (c++ as a keyword)', () => {
    global.__LI.setCfg({ includeKeywords: ['c++'] });
    const cpp = makePost('C++ engineer');
    const hits = global.__LI.scanKeywords([cpp]);
    expect(hits).toHaveLength(1);
    expect(hits[0].keywords).toEqual(['c++']);
  });

  test('returns an empty array for an empty post list', () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    expect(global.__LI.scanKeywords([])).toEqual([]);
  });
});
