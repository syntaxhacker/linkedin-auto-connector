'use strict';

/**
 * filterPosts(posts) — temporarily hides (does NOT remove) posts whose text
 * matches an EXCLUDE keyword (literal substring). Hidden posts keep their DOM
 * node and get the class 'li-ac-hidden' (the single source of hidden state).
 * Include keywords never hide posts — they only highlight.
 * Returns the number of posts newly hidden.
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

const HIDDEN = 'li-ac-hidden';

describe('filterPosts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  test('exclude [".net"] hides only posts with the literal ".net" substring; "internet"/"network"/"connect" survive', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });

    const aspNet = makePost('Looking for an ASP.NET developer');
    const netCore = makePost('.NET Core backend role');
    const xNet = makePost('maintaining the x.net library');
    const internet = makePost('Building systems at internet scale');
    const network = makePost('Network engineer opportunity');
    const connect = makePost('Connect with me on LinkedIn');
    const dotnet = makePost('dotnet core is my stack');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());

    expect(hidden).toBe(3);
    expect(global.__LI.getHiddenCount()).toBe(3);
    // Hidden = class added, node still in the DOM:
    expect(aspNet.classList.contains(HIDDEN)).toBe(true);
    expect(netCore.classList.contains(HIDDEN)).toBe(true);
    expect(xNet.classList.contains(HIDDEN)).toBe(true);
    // Survivors stay visible:
    expect(internet.classList.contains(HIDDEN)).toBe(false);
    expect(network.classList.contains(HIDDEN)).toBe(false);
    expect(connect.classList.contains(HIDDEN)).toBe(false);
    expect(dotnet.classList.contains(HIDDEN)).toBe(false);
    // All nodes remain attached (nothing was removed):
    expect(document.body.contains(aspNet)).toBe(true);
    expect(document.body.contains(internet)).toBe(true);
  });

  test('uppercase post text is still filtered (text is lowercased before matching)', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const asp = makePost('ASP.NET Developer Position Open');
    const web = makePost('INTERNET SCALE COMPANY');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());

    expect(hidden).toBe(1);
    expect(asp.classList.contains(HIDDEN)).toBe(true);
    expect(web.classList.contains(HIDDEN)).toBe(false);
  });

  test('include keywords never hide posts — a non-matching post stays visible', () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    const react = makePost('React Developer needed');
    const reactions = makePost('Looking for reactions on our post');
    const vue = makePost('Vue.js role available');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());

    expect(hidden).toBe(0); // include filter must not hide anything
    expect(global.__LI.getHiddenCount()).toBe(0);
    expect(document.body.contains(react)).toBe(true);
    expect(document.body.contains(reactions)).toBe(true);
    expect(document.body.contains(vue)).toBe(true);
  });

  test('no include and no exclude keywords keeps every post', () => {
    const a = makePost('just a post');
    const b = makePost('another one');

    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(0);
    expect(global.__LI.getHiddenCount()).toBe(0);
    expect(a.classList.contains(HIDDEN)).toBe(false);
    expect(b.classList.contains(HIDDEN)).toBe(false);
  });

  test('exclude wins regardless of include keywords', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['.net'] });
    const both = makePost('React and .NET full stack engineer');
    const onlyReact = makePost('React frontend specialist');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());

    expect(hidden).toBe(1);
    expect(both.classList.contains(HIDDEN)).toBe(true);
    expect(onlyReact.classList.contains(HIDDEN)).toBe(false);
  });

  test('multiple excludes are applied case-insensitively', () => {
    global.__LI.setCfg({ excludeKeywords: ['JAVA', 'PHP'] });
    const java = makePost('Senior Java developer');
    const php = makePost('PHP backend engineer');
    const python = makePost('Python data engineer');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());

    expect(hidden).toBe(2);
    expect(java.classList.contains(HIDDEN)).toBe(true);
    expect(php.classList.contains(HIDDEN)).toBe(true);
    expect(python.classList.contains(HIDDEN)).toBe(false);
  });

  test('a regex-dangerous exclude keyword like "c++" does not throw', () => {
    global.__LI.setCfg({ excludeKeywords: ['c++'] });
    const cpp = makePost('C++ engineer at a fintech');
    const go = makePost('Go engineer');

    let hidden;
    expect(() => {
      hidden = global.__LI.filterPosts(global.__LI.getPosts());
    }).not.toThrow();

    expect(hidden).toBe(1);
    expect(cpp.classList.contains(HIDDEN)).toBe(true);
    expect(go.classList.contains(HIDDEN)).toBe(false);
  });

  test('return value equals the number of newly hidden posts', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    makePost('one .net post');
    makePost('two internet post');
    makePost('three .NET post');

    const hidden = global.__LI.filterPosts(global.__LI.getPosts());
    expect(hidden).toBe(2);
  });

  test('already-hidden posts are not double-counted on a second run', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const a = makePost('one .net post');
    const b = makePost('plain post');

    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(1);
    expect(global.__LI.getHiddenCount()).toBe(1);
    // Second pass: a is already hidden, b does not match — nothing new.
    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(0);
    expect(a.classList.contains(HIDDEN)).toBe(true);
    expect(b.classList.contains(HIDDEN)).toBe(false);
  });

  test('returns 0 when given an empty post list', () => {
    expect(global.__LI.filterPosts([])).toBe(0);
  });
});

describe('restoreHidden (hidden posts are not destroyed)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  test('clearing exclude keywords brings hidden posts back', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const post = makePost('we use .NET here');
    expect(global.__LI.filterPosts(global.__LI.getPosts())).toBe(1);

    global.__LI.setCfg({ excludeKeywords: [] });
    expect(global.__LI.restoreHidden()).toBe(1);

    expect(post.classList.contains(HIDDEN)).toBe(false);
    expect(global.__LI.getHiddenCount()).toBe(0);
    expect(document.body.contains(post)).toBe(true);
    expect(global.__LI.getPosts()).toContain(post);
  });

  test('restoreHidden with nothing hidden returns 0', () => {
    makePost('nothing to restore');
    expect(global.__LI.restoreHidden()).toBe(0);
  });

  test('getHiddenPosts returns the hidden post elements', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const a = makePost('a .net post');
    const b = makePost('b plain post');
    global.__LI.filterPosts(global.__LI.getPosts());

    const hidden = global.__LI.getHiddenPosts();
    expect(hidden).toEqual([a]);
    expect(b.classList.contains(HIDDEN)).toBe(false);
  });
});
