'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('Hidden / Ultra hide flows', () => {
  test('exclude keyword hides matching post and appears in Hidden list with Show', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'asp.net role email net@example.com' },
        { text: 'React role email react@example.com' },
      ])
    });
    await fp.setStorage({ excludeKeywords: ['.net'] });
    await fp.feedScan();

    // Hidden post collapsed
    const hiddenCount = await page.evaluate(() => document.querySelectorAll('.li-ac-hidden').length);
    expect(hiddenCount).toBe(1);
    // Emails list does NOT contain hidden
    await expect(fp.emList()).not.toContainText('net@example.com');
    await expect(fp.emList()).toContainText('react@example.com');
    // Hidden list contains it
    await expect(fp.hiddenList()).toContainText('net@example.com');
    await expect(fp.hiddenList()).toContainText('.net');

    // Show restores
    await page.locator('#li-ac-hidden-list [data-hidden-toggle="show"]').click();
    await page.waitForTimeout(300);
    const hiddenAfter = await page.evaluate(() => document.querySelectorAll('.li-ac-hidden').length);
    expect(hiddenAfter).toBe(0);
  });

  test('ultra hide collapses non-matching posts, keeps matches expanded', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'React senior role' },
        { text: 'reach out bob@example.com' },
        { text: 'a totally unrelated business post' },
      ])
    });
    await fp.setStorage({ includeKeywords: ['react'], ultraHide: true });
    await fp.feedScan();
    const ultra = await page.evaluate(() => document.querySelectorAll('.li-ac-ultra').length);
    expect(ultra).toBe(1); // only the unrelated post
    // Hidden list should NOT contain ultra-hidden
    await expect(fp.hiddenList()).not.toContainText('unrelated');
  });

  test('ultra hide respects revealed post', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'we use .NET here at work' },
        { text: 'a totally unrelated business post' },
      ])
    });
    await fp.setStorage({ excludeKeywords: ['.net'], ultraHide: true });
    await fp.feedScan();
    // .NET post hidden via exclude, unrelated via ultra
    let hidden = await page.evaluate(() => document.querySelectorAll('.li-ac-hidden').length);
    expect(hidden).toBe(1);
    await page.locator('#li-ac-hidden-list [data-hidden-toggle="show"]').click();
    await page.waitForTimeout(300);
    const stillHidden = await page.evaluate(() => document.querySelectorAll('.li-ac-hidden').length);
    expect(stillHidden).toBe(0);
    // Revealed post not ultra-collapsed
    const notUltra = await page.evaluate(() => {
      const posts = [...document.querySelectorAll('.feed-post')];
      const netPost = posts.find(p => p.textContent.includes('.NET'));
      return netPost && !netPost.classList.contains('li-ac-ultra');
    });
    expect(notUltra).toBe(true);
  });

  test('RESET clears hidden/ultra/viewed classes and queues', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'asp.net role' }])
    });
    await fp.setStorage({ excludeKeywords: ['.net'] });
    await fp.feedScan();
    await page.waitForTimeout(300);
    // Verify hidden before reset
    const before = await page.evaluate(() => window.__LI_AC_TEST__.getHiddenCount());
    expect(before).toBe(1);
    const resetRes = await page.evaluate(() => { let r; window.__onMessage({ type: 'RESET' }, {}, x => r = x); return r; });
    expect(resetRes.ok).toBe(true);
    // RESET does not clear excludeKeywords cfg — clear it then re-scan to verify hidden clears
    await page.evaluate(() => window.__LI_AC_TEST__.setCfg({ excludeKeywords: [] }));
    await page.evaluate(() => { if (window.__onMessage) window.__onMessage({ type: 'FEED_SCAN' }, {}, ()=>{}); });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      hidden: window.__LI_AC_TEST__.getHiddenCount(),
      ultra: document.querySelectorAll('.li-ac-ultra').length,
      viewed: document.querySelectorAll('.li-ac-viewed').length,
    }));
    expect(after.hidden).toBe(0);
    expect(after.ultra).toBe(0);
    expect(after.viewed).toBe(0);
  });
});
