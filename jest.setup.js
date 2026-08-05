'use strict';

/**
 * jest.setup.js
 *
 * Runs before every test file (testEnvironment: jsdom).
 *
 * Responsibilities:
 *  1. Define the LI_PALETTE global (mirrors palette.js, which the manifest
 *     loads before content.js).
 *  2. Define a chrome.* mock (storage.sync.get/set, storage.onChanged,
 *     runtime.onMessage) and capture the registered listeners so tests can
 *     drive the message / storage-change handlers.
 *  3. Patch jsdom gaps that break scanButtons/renderPanel:
 *       - offsetParent is null in jsdom -> return a truthy object by default
 *         (tests can set `el._offsetParent = null` to simulate hidden nodes).
 *       - scrollIntoView is not implemented -> no-op mock.
 *  4. Load content.js once (executes the IIFE) and expose the test surface as
 *     global.__LI.
 *  5. Tear down content.js init-time side effects (feed observer, initial
 *     scanFeed timeout, auto-scroll interval) so tests start clean.
 */

// ---------------------------------------------------------------------------
// 1. Palette (5 color keys, same values as palette.js)
// ---------------------------------------------------------------------------
global.LI_PALETTE = {
  inkBlack: '#0d1321',
  deepSpaceBlue: '#1d2d44',
  blueSlate: '#3e5c76',
  dustyDenim: '#748cab',
  eggshell: '#f0ebd8'
};

// ---------------------------------------------------------------------------
// 2. chrome.* mock
// ---------------------------------------------------------------------------
const STORAGE_DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: true,
  debug: true
};

global.chrome = {
  storage: {
    sync: {
      // content.js calls storage.sync.get(defaults, cb); we always deliver the
      // spec'd defaults so the init path is deterministic in tests.
      get: jest.fn((_defaults, callback) => {
        callback({ ...STORAGE_DEFAULTS });
      }),
      set: jest.fn((_obj, callback) => {
        if (typeof callback === 'function') callback();
      })
    },
    onChanged: {
      addListener: jest.fn(listener => {
        global.__onChanged = listener;
      })
    }
  },
  runtime: {
    onMessage: {
      addListener: jest.fn(listener => {
        global.__onMessage = listener;
      })
    }
  }
};

// ---------------------------------------------------------------------------
// 3. jsdom patches
// ---------------------------------------------------------------------------
// jsdom returns null for offsetParent, which makes scanButtons skip every
// button. Default to a truthy object; tests can set `el._offsetParent = null`
// to simulate a hidden element.
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    if (Object.prototype.hasOwnProperty.call(this, '_offsetParent')) {
      return this._offsetParent;
    }
    return {};
  }
});

// jsdom does not implement scrollIntoView; renderPanel and panel click
// handlers call it. Use a jest mock so tests can assert auto-scroll behavior.
Element.prototype.scrollIntoView = jest.fn();

// ---------------------------------------------------------------------------
// 4. Load the content script (executes its IIFE)
// ---------------------------------------------------------------------------
require('./content.js');

// ---------------------------------------------------------------------------
// 5. Expose the test surface and tear down init-time side effects
// ---------------------------------------------------------------------------
global.__LI = globalThis.__LI_AC_TEST__;

if (!global.__LI) {
  throw new Error('content.js did not expose globalThis.__LI_AC_TEST__');
}

global.__LI.cleanup(); // disconnect feed observer, clear scanFeed timeout, stop auto-scroll interval
