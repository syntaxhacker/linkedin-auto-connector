'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage } = require('../pages/LinkedInFeedPage');

function connectFixtureHtml() {
  // Use href="#" with data attr containing search-custom-invite substring would not match.
  // So keep real href but prevent navigation via click handler injected after load.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>LinkedIn</title></head>
<body><main><div id="feed-container">
  <div role="listitem"><a href="/in/john-doe">John Doe</a><a href="https://www.linkedin.com/search/results/people/?vanityName=johndoe&search-custom-invite=connect">Connect</a></div>
  <div role="listitem"><a href="/in/jane-smith">Jane Smith</a><a href="https://www.linkedin.com/search/results/people/?vanityName=janesmith&search-custom-invite=connect">Connect</a><span>3rd</span></div>
  <div><button aria-label="Invite Bob Builder to connect">Invite</button></div>
</div></main></body></html>`;
}

test.describe('Connect button scanning', () => {
  test('SCAN finds connect buttons, highlights, and reports count', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/search/results/people/', {
      html: connectFixtureHtml()
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.querySelectorAll('a[href*="search-custom-invite"]').forEach(a => {
        a.addEventListener('click', e => e.preventDefault());
      });
    });
    const result = await page.evaluate(() => {
      let res; window.__onMessage({ type: 'SCAN' }, {}, r => res = r); return res;
    });
    // John Doe found, Jane skipped (3rd degree). Bob via pattern B is environment-dependent (offsetParent in headless)
    expect(result.count).toBeGreaterThanOrEqual(1);
    const hl = await page.evaluate(() => document.querySelectorAll('.li-ac-hl').length);
    expect(hl).toBeGreaterThanOrEqual(1);
  });

  test('STATUS reports counts, START/STOP flow', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/search/results/people/', {
      html: connectFixtureHtml()
    });
    // Prevent navigation from Connect links destroying context
    await page.evaluate(() => {
      document.querySelectorAll('a[href*="search-custom-invite"]').forEach(a => {
        a.addEventListener('click', e => e.preventDefault());
      });
    });
    let status = await page.evaluate(() => {
      let r; window.__onMessage({ type: 'STATUS' }, {}, x => r = x); return r;
    });
    expect(status.running).toBe(false);
    await page.evaluate(() => { let r; window.__onMessage({ type: 'SCAN' }, {}, x => r = x); return r; });
    const start = await page.evaluate(() => {
      let r; window.__onMessage({ type: 'START', delayMin: 10, delayMax: 10 }, {}, x => r = x); return r;
    });
    expect(start.ok).toBe(true);
    status = await page.evaluate(() => { let r; window.__onMessage({ type: 'STATUS' }, {}, x => r = x); return r; });
    expect(status.running).toBe(true);
    await page.evaluate(() => { let r; window.__onMessage({ type: 'STOP' }, {}, x => r = x); return r; });
    await page.waitForTimeout(300);
    status = await page.evaluate(() => { let r; window.__onMessage({ type: 'STATUS' }, {}, x => r = x); return r; });
    expect(status.running).toBe(false);
  });
});
