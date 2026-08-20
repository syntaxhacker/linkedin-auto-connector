'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('Feed scanning — keyword/email panels', () => {
  test('include keyword highlights and renders under Emails when post has email', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'React dev email bob@example.com' },
        { text: 'Vue job, no match' },
      ])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();

    await expect(fp.panel()).toBeVisible();
    await expect(fp.foundPanel()).toBeVisible();
    // Post with both keyword and email appears only under Emails
    await expect(fp.emList()).toContainText('bob@example.com');
    // Should highlight
    const hlCount = await page.evaluate(() => document.querySelectorAll('.li-ac-kw-hl').length);
    expect(hlCount).toBe(1);
    await expect(fp.panel()).toBeVisible();
    // Screenshot artifact
    await page.screenshot({ path: 'artifacts/feed-scan-keyword-email.png', fullPage: false });
  });

  test('keyword-only post appears under Keywords', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/search/results/people/', {
      html: fixtureHtml([{ text: 'React senior role, no contact details here' }])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    await expect(fp.kwList()).toContainText('react');
    await expect(fp.emList()).toContainText('No email matches');
  });

  test('email matches render correctly', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'reach me at alice@example.com for hiring' }])
    });
    await fp.setStorage({ includeKeywords: [] });
    await fp.feedScan();
    await expect(fp.emList()).toContainText('alice@example.com');
  });

  test('empty feed shows No email matches placeholder', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'no contact details at all' }])
    });
    await fp.feedScan();
    await expect(fp.emList()).toContainText('No email matches');
  });

  test('postBodyText ignores non-P children — headline does not trigger match', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    // Custom HTML where post has headline with react but P has no keyword
    const html = `<!DOCTYPE html><html><body><main><div id="feed-container">
      <div class="feed-post"><h2>Feed post</h2> <span>React Developer at Acme</span><p>Vue job no match</p></div>
    </div></main></body></html>`;
    await fp.goto('https://www.linkedin.com/feed/', { html });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    // Should NOT match because only P is scanned
    await expect(fp.kwList()).toContainText('No keyword matches');
    await expect(fp.emList()).toContainText('No email matches');
  });
});
