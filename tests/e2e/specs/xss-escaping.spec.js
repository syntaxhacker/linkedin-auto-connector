'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('XSS escaping in panel rendering', () => {
  test('keyword containing HTML is escaped in tags and rows', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'hello <script>alert(1)</script> bob@example.com' }])
    });
    // Include keyword with HTML chars — should be escaped, not executed
    await fp.setStorage({ includeKeywords: ['<script>'] });
    await fp.feedScan();
    // Check that no script tag was injected
    const scriptCount = await page.evaluate(() => document.querySelectorAll('#li-ac-found-panel script').length);
    expect(scriptCount).toBe(0);
  });

  test('email snippet is escaped', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    // Need to inject post via DOM textContent so <img is text, not parsed HTML
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'placeholder' }])
    });
    await page.evaluate(() => {
      const p = document.querySelector('.feed-post p');
      if (p) p.textContent = 'contact bob@example.com <img onerror=alert(1)>';
    });
    await fp.feedScan();
    const inner = await page.evaluate(() => document.querySelector('#li-ac-panel-list')?.innerHTML || '');
    expect(inner).not.toContain('<img onerror');
    expect(inner).toContain('&lt;img');
  });
});
