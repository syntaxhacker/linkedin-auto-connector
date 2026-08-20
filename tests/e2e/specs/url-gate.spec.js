'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('URL gate — allowed vs gated pages', () => {
  test('allowed URL /feed renders without gate overlay', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'React dev bob@example.com' }])
    });
    await fp.feedScan();
    await expect(fp.gateOverlays()).toHaveCount(0);
    await expect(fp.emList()).toContainText('bob@example.com');
  });

  test('allowed URL /search renders without gate overlay', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/search/results/people/?keywords=react', {
      html: fixtureHtml([{ text: 'React dev bob@example.com' }])
    });
    await fp.feedScan();
    await expect(fp.gateOverlays()).toHaveCount(0);
  });

  test('allowed URL /company/*/people renders without gate', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/company/acme/people/', {
      html: fixtureHtml([{ text: 'bob@example.com' }])
    });
    await fp.feedScan();
    await expect(fp.gateOverlays()).toHaveCount(0);
  });

  test('disallowed URL shows blurred gate overlays on both panels', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/jobs/', {
      html: fixtureHtml([{ text: 'bob@example.com' }])
    });
    // Gate renders immediately via init, wait a bit
    await page.waitForTimeout(800);
    const overlays = fp.gateOverlays();
    await expect(overlays).toHaveCount(2);
    await expect(overlays.first()).toContainText('Works only on LinkedIn Search');
    // Overlay should be pointer-events:none and cover panels
    const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.li-ac-gate-overlay')).pointerEvents);
    expect(pe).toBe('none');
  });

  test('disallowed URL also gates /in profile pages', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/in/johndoe', {
      html: fixtureHtml([{ text: 'bob@example.com' }])
    });
    await page.waitForTimeout(800);
    await expect(fp.gateOverlays()).toHaveCount(2);
  });

  test('isAllowedUrl handles edge cases via direct API', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', { html: fixtureHtml([]) });
    const results = await page.evaluate(() => {
      const t = window.__LI_AC_TEST__;
      return {
        feed: t.isAllowedUrl(new URL('https://www.linkedin.com/feed')),
        search: t.isAllowedUrl(new URL('https://www.linkedin.com/search')),
        jobs: t.isAllowedUrl(new URL('https://www.linkedin.com/jobs/')),
        evil: t.isAllowedUrl(new URL('https://evil-linkedin.com/search/')),
        companyPeople: t.isAllowedUrl(new URL('https://www.linkedin.com/company/acme/people/')),
        companyRoot: t.isAllowedUrl(new URL('https://www.linkedin.com/company/acme/')),
      };
    });
    expect(results.feed).toBe(true);
    expect(results.search).toBe(true);
    expect(results.companyPeople).toBe(true);
    expect(results.jobs).toBe(false);
    expect(results.evil).toBe(false);
    expect(results.companyRoot).toBe(false);
  });

  test('SCAN/START on gated page returns count 0 / ok false', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/jobs/', { html: fixtureHtml([]) });
    await page.waitForTimeout(500);
    const scanRes = await page.evaluate(() => {
      let res; window.__onMessage({ type: 'SCAN' }, {}, r => res = r); return res;
    });
    expect(scanRes).toEqual({ count: 0 });
    const startRes = await page.evaluate(() => {
      let res; window.__onMessage({ type: 'START', delayMin: 100, delayMax: 100 }, {}, r => res = r); return res;
    });
    expect(startRes).toEqual({ ok: false });
  });
});
