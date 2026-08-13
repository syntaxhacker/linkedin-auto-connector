'use strict';

/**
 * Debug logging — dbg() only writes to console when cfg.debug is true.
 * We spy on console.log to prove gating.
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

describe('debug logging (cfg.debug)', () => {
  let logSpy;

  beforeEach(() => {
    document.body.innerHTML = '';
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.__LI.setCfg({ ...DEFAULTS });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('logs nothing when debug is false', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    makePost('a .net post');
    global.__LI.filterPosts(global.__LI.getPosts());
    global.__LI.restoreHidden();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('logs hidden/restore events when debug is true', () => {
    global.__LI.setCfg({ debug: true, excludeKeywords: ['.net'] });
    makePost('a .net post');
    global.__LI.filterPosts(global.__LI.getPosts());
    expect(logSpy).toHaveBeenCalled();
    const all = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(all).toContain('[Job Radar]');
    expect(all).toContain('hidden post');
  });

  test('logs keyword highlights when debug is true', () => {
    global.__LI.setCfg({ debug: true, includeKeywords: ['react'] });
    makePost('React role');
    global.__LI.scanKeywords(global.__LI.getPosts());
    const all = logSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(all).toContain('keyword hit');
  });
});
