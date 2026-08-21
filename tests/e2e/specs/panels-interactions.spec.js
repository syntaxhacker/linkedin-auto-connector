'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('Panel interactions — minimize to bubble, clear seen, sorting', () => {
  test('panels have no close button, minimize collapses to bubble', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'hello bob@example.com' }])
    });
    await fp.feedScan();
    await expect(fp.panel()).toBeVisible();
    await expect(page.locator('#li-ac-panel-close')).toHaveCount(0);
    await expect(page.locator('#li-ac-found-close')).toHaveCount(0);

    await page.locator('#li-ac-panel-min').click();
    await expect(fp.panel()).toBeHidden();
    await expect(fp.bubble()).toBeVisible();
    // Bubble click restores
    await fp.bubble().click();
    await expect(fp.panel()).toBeVisible();
  });

  test('include/exclude keyword inputs: Enter adds tag and re-scans', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'React role here' }])
    });
    await fp.feedScan();
    const inc = page.locator('#li-ac-kw-include');
    await inc.fill('react, python');
    await inc.press('Enter');
    await page.waitForTimeout(600);
    // Tags rendered
    await expect(page.locator('#li-ac-tags-include')).toContainText('react');
    await expect(page.locator('#li-ac-tags-include')).toContainText('python');
  });

  test('removing a keyword tag via x button', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'React role here' }])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    await expect(page.locator('#li-ac-tags-include')).toContainText('react');
    await page.locator('[data-kw-remove="react"]').click();
    await page.waitForTimeout(600);
    await expect(page.locator('#li-ac-tags-include')).not.toContainText('react');
  });

  test('clear seen removes viewed rows and marks feed post with viewed class', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'React role no email here' }])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    // Ensure Keywords tab active (narrow mode)
    await page.locator('#li-ac-tab-kw').click();
    await page.waitForTimeout(200);
    const row = page.locator('[data-kind="kw"]').first();
    await expect(row).toBeVisible();
    await page.evaluate(() => document.querySelector('[data-kind="kw"]')?.click());
    await page.waitForTimeout(200);
    // Row now has seen marker
    await expect(row).toContainText('seen');
    // Clear seen removes it
    await page.locator('#li-ac-clear-seen').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-kind="kw"]')).toHaveCount(0);
    // Feed post has viewed marker class
    const viewed = await page.evaluate(() => document.querySelector('.feed-post')?.classList.contains('li-ac-viewed'));
    expect(viewed).toBe(true);
  });

  test('sort toggle changes label and filters', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'React role senior dev no email here one' },
        { text: 'React role senior dev no email here two' },
      ])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    await page.locator('#li-ac-tab-kw').click();
    await page.waitForTimeout(200);
    const sortBtn = page.locator('#li-ac-kw-sort');
    // Default is Newest (blue) — kw hits exist, so bar is visible
    await expect(sortBtn).toBeVisible();
    await expect(sortBtn).toContainText('Newest');
    await sortBtn.click();
    await page.waitForTimeout(600);
    await expect(sortBtn).toContainText('Feed order');
  });

  test('panel click disables auto-scroll', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'React role no email' }])
    });
    await fp.setStorage({ includeKeywords: ['react'], autoScroll: true });
    await fp.feedScan();
    // Auto-scroll toggle should be checked
    await expect(page.locator('#li-ac-autoscroll')).toBeChecked();
    // Clicking a kw row disables it
    await page.locator('#li-ac-tab-kw').click();
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('[data-kind="kw"]')?.click());
    await page.waitForTimeout(300);
    await expect(page.locator('#li-ac-autoscroll')).not.toBeChecked();
  });
});
