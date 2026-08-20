'use strict';
const fs = require('fs');
const path = require('path');

function fixtureHtml(posts) {
  // posts: array of {text, h2}
  const postsHtml = (posts || []).map(p => {
    const h2 = p.h2 || 'Feed post';
    const body = p.text != null ? `<p>${p.text}</p>` : '';
    return `<div class="feed-post"><h2>${h2}</h2> ${body}</div>`;
  }).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LinkedIn</title>
<style>main{height:2000px} .feed-post{padding:12px;border:1px solid #ddd;margin:8px}</style>
</head><body><main><div id="feed-container">${postsHtml}</div></main></body></html>`;
}

class LinkedInFeedPage {
  constructor(page) {
    this.page = page;
  }

  // Sets up chrome mock + palette before navigation, routes linkedin.com to fixture, injects content.js
  async goto(url, { posts = null, html = null } = {}) {
    const paletteSrc = fs.readFileSync(path.join(__dirname, '../../../palette.js'), 'utf8');
    const contentSrc = fs.readFileSync(path.join(__dirname, '../../../content.js'), 'utf8');

    const htmlToServe = html || fixtureHtml(posts || [
      { text: 'React dev email bob@example.com' },
      { text: 'Vue job no match' },
    ]);

    await this.page.unrouteAll({ behavior: 'wait' }).catch(()=>{});
    // Intercept all linkedin.com navigations to serve fixture HTML with correct URL
    await this.page.route('**://www.linkedin.com/**', async route => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: htmlToServe });
    });

    // Inject chrome mock + palette before any script runs
    await this.page.addInitScript(() => {
      // Palette (mirrors palette.js)
      window.LI_PALETTE = {
        inkBlack: '#0d1321', deepSpaceBlue: '#1d2d44', blueSlate: '#3e5c76', dustyDenim: '#748cab', eggshell: '#f0ebd8',
        ok: '#22c55e', okText: '#4ade80', warn: '#fbbf24', danger: '#f87171', info: '#60a5fa', infoOnWhite: '#2563eb', focus: '#60a5fa',
        cardBg: '#141414', borderSoft: '#444444', borderStrong: '#666666', muted: '#bbbbbb',
        seenChipBg: 'rgba(34,197,94,.15)', seenRowTint: 'rgba(34,197,94,.06)', seenBorder: '#22c55e'
      };
      // Minimal chrome mock
      window.__storageData = {
        autoExpand: true, scanEmails: true, includeKeywords: [], excludeKeywords: [], autoScroll: false, ultraHide: false, debug: false,
        kwSectionCollapsed: false, autoScrollDurationMin: 0, panelMinimized: false, foundPanelMinimized: false
      };
      window.chrome = {
        storage: {
          sync: {
            get(defaults, cb) {
              const out = Object.assign({}, defaults, window.__storageData);
              if (cb) cb(out);
            },
            set(obj, cb) {
              Object.assign(window.__storageData, obj);
              // fire onChanged listeners
              if (window.__onChanged) {
                const changes = {};
                Object.keys(obj).forEach(k => changes[k] = { newValue: obj[k] });
                window.__onChanged(changes, 'sync');
              }
              if (cb) cb();
            }
          },
          onChanged: {
            addListener(fn) { window.__onChanged = fn; },
            removeListener() { window.__onChanged = null; }
          }
        },
        runtime: {
          onMessage: {
            addListener(fn) { window.__onMessage = fn; },
            removeListener() {}
          },
          lastError: null
        },
        tabs: { query() {}, sendMessage() {} },
        contextMenus: {}
      };
      // jsdom patch not needed in real chromium
      window.__onMessage = null;
      window.__onChanged = null;
    });

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    // Now inject content.js (after palette + chrome mock exist)
    await this.page.addScriptTag({ content: paletteSrc });
    await this.page.addScriptTag({ content: contentSrc });
    // Wait for content.js init (400ms scan debounce)
    await this.page.waitForTimeout(600);
  }

  async setStorage(obj) {
    await this.page.evaluate((o) => {
      Object.assign(window.__storageData, o);
      // Directly sync cfg for keys that onChanged doesn't cover (ultraHide, etc)
      if (window.__LI_AC_TEST__ && window.__LI_AC_TEST__.setCfg) {
        window.__LI_AC_TEST__.setCfg(o);
      }
      if (window.__onChanged) {
        const changes = {};
        Object.keys(o).forEach(k => changes[k] = { newValue: o[k] });
        window.__onChanged(changes, 'sync');
      }
    }, obj);
  }

  async feedScan() {
    await this.page.evaluate(() => {
      if (window.__onMessage) {
        window.__onMessage({ type: 'FEED_SCAN' }, {}, () => {});
      }
    });
    await this.page.waitForTimeout(600);
  }

  async getTestSurface() {
    return this.page.evaluate(() => {
      const t = window.__LI_AC_TEST__;
      if (!t) return null;
      return { hasSurface: true, cfg: t.getCfg(), hidden: t.getHiddenCount() };
    });
  }

  // Locators
  panel() { return this.page.locator('#li-ac-panel'); }
  foundPanel() { return this.page.locator('#li-ac-found-panel'); }
  bubble() { return this.page.locator('#li-ac-bubble'); }
  kwList() { return this.page.locator('#li-ac-kw-list'); }
  emList() { return this.page.locator('#li-ac-panel-list'); }
  hiddenList() { return this.page.locator('#li-ac-hidden-list'); }
  gateOverlays() { return this.page.locator('.li-ac-gate-overlay'); }

  async addHiddenPost(text) {
    await this.page.evaluate((t) => {
      const post = document.createElement('div');
      post.className = 'feed-post';
      const h2 = document.createElement('h2');
      h2.textContent = 'Feed post';
      post.appendChild(h2);
      post.appendChild(document.createTextNode(' '));
      const p = document.createElement('p');
      p.textContent = t;
      post.appendChild(p);
      document.querySelector('#feed-container').appendChild(post);
    }, text);
  }
}

module.exports = { LinkedInFeedPage, fixtureHtml };
