'use strict';

/**
 * Initialization + config management.
 *   - chrome.storage.sync.get defaults are applied to cfg at load time.
 *   - chrome.storage.onChanged updates cfg from the sync area (and ignores
 *     other areas).
 *   - setCfg merges partial config; getCfg returns the current config.
 */

describe('content.js initialization', () => {
  test('loads config from chrome.storage.sync.get defaults', () => {
    expect(global.chrome.storage.sync.get).toHaveBeenCalled();
    expect(global.__LI.getCfg().autoExpand).toBe(true);
    expect(global.__LI.getCfg().scanEmails).toBe(true);
    expect(global.__LI.getCfg().autoScroll).toBe(true);
    expect(global.__LI.getCfg().debug).toBe(true);
    expect(global.__LI.getCfg().includeKeywords).toEqual([]);
    expect(global.__LI.getCfg().excludeKeywords).toEqual([]);
  });

  test('registers the runtime.onMessage and storage.onChanged listeners', () => {
    expect(typeof global.__onMessage).toBe('function');
    expect(typeof global.__onChanged).toBe('function');
  });

  test('exposes the expected test surface', () => {
    const fns = [
      'kwMatch', 'kwParts', 'esc', 'wordMatch', 'getPosts', 'filterPosts', 'scanEmails',
      'scanKeywords', 'expandPosts', 'scanButtons', 'restoreHidden',
      'getHiddenCount', 'getHiddenPosts', 'clearKeywordHighlights',
      'injectStyles', 'startFeedObserver', 'getScroller', 'renderTags',
      'removeKeyword', 'escHtml', 'extractKeywordsFromPost',
      'addRightClickedTo', 'captureRightClick',
      'startAutoScroll', 'stopAutoScroll', 'disableAutoScroll',
      'getAutoScrollDurationMin', 'setAutoScrollDurationMin',
      'revealHiddenPost', 'rehidePost', 'applyUltraHide',
      'knownEmailsAdd', 'knownEmailsClear', 'timeAgo',
      'postKey', 'markViewed', 'resetHitMeta', 'sortedHits',
      'getKwSectionCollapsed', 'setKwSectionCollapsed', 'toggleKwSection',
      'getCfg', 'setCfg', 'getCounts', 'cleanup'
    ];
    for (const fn of fns) {
      expect(typeof global.__LI[fn]).toBe('function');
    }
    expect(global.__LI.EMAIL_RE).toBeInstanceOf(RegExp);
    expect(global.__LI.hitMeta).toBeInstanceOf(Function); // getter returns a Map
    expect(global.__LI.hitMeta()).toBeInstanceOf(Map);
    expect(global.__LI.sortNewest).toBeDefined();
    expect(typeof global.__LI.sortNewest.kw).toBe('boolean');
    expect(typeof global.__LI.sortNewest.em).toBe('boolean');
    expect(global.__LI.scrollLock).toBeDefined();
    expect(typeof global.__LI.scrollLock.acquire).toBe('function');
  });
});

describe('setCfg / getCfg', () => {
  test('setCfg merges partial config without wiping untouched keys', () => {
    global.__LI.setCfg({ includeKeywords: ['react'] });
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react']);
    expect(global.__LI.getCfg().autoExpand).toBe(true);
    expect(global.__LI.getCfg().excludeKeywords).toEqual([]);
  });

  test('setCfg can update multiple keys at once', () => {
    global.__LI.setCfg({ includeKeywords: ['react'], excludeKeywords: ['.net'], autoScroll: true });
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react']);
    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net']);
    expect(global.__LI.getCfg().autoScroll).toBe(true);
  });
});

describe('chrome.storage.onChanged handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({
      autoExpand: true, scanEmails: true, includeKeywords: [], excludeKeywords: [], autoScroll: false
    });
    global.chrome.storage.sync.set.mockClear();
  });

  afterEach(() => {
    global.__LI.cleanup();
  });

  test('applies sync changes to cfg', () => {
    global.__onChanged({ autoExpand: { newValue: false } }, 'sync');
    expect(global.__LI.getCfg().autoExpand).toBe(false);
  });

  test('updates include and exclude keywords from sync changes', () => {
    global.__onChanged(
      { includeKeywords: { newValue: ['react'] }, excludeKeywords: { newValue: ['.net'] } },
      'sync'
    );
    expect(global.__LI.getCfg().includeKeywords).toEqual(['react']);
    expect(global.__LI.getCfg().excludeKeywords).toEqual(['.net']);
  });

  test('ignores changes from non-sync storage areas', () => {
    global.__LI.setCfg({ autoExpand: true });
    global.__onChanged({ autoExpand: { newValue: false } }, 'local');
    expect(global.__LI.getCfg().autoExpand).toBe(true);
  });

  test('starts auto-scroll when autoScroll becomes true', () => {
    global.__onChanged({ autoScroll: { newValue: true } }, 'sync');
    expect(global.__LI.getCfg().autoScroll).toBe(true);
  });

  test('stops auto-scroll when autoScroll becomes false', () => {
    global.__onChanged({ autoScroll: { newValue: true } }, 'sync');
    global.__onChanged({ autoScroll: { newValue: false } }, 'sync');
    expect(global.__LI.getCfg().autoScroll).toBe(false);
  });
});
