'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage } = require('../pages/LinkedInFeedPage');

test.describe('Jev mode — AI categorize end to end', () => {
  test('pending chips become verdicts; non-relevant concealed with peek', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      posts: [
        { text: 'Senior React frontend role with 5 years experience hiring now' },
        { text: 'Intern post seeking Java developers apply today' },
      ]
    });
    // Stub the background relay (no network): c0 relevant, c1 excluded.
    await page.evaluate(() => {
      window.__LI_AC_TEST__.setLlmKey('jev', 'e2e-key');
      window.__llmRelayImpl = async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify({ answers: {
          c0: { choice: 'relevant', confidence: 0.92, probabilities: {} },
          c1: { choice: 'excluded', confidence: 0.88, probabilities: {} },
        } }),
      });
    });
    await fp.setStorage({
      jevMode: true,
      includeKeywords: ['react'],
      jevCategories: [
        { id: 'relevant', label: 'relevant', criteria: 'React roles', action: 'expand' },
        { id: 'excluded', label: 'excluded', criteria: 'intern/java', action: 'collapse' },
      ],
    });
    await fp.feedScan();

    const chips = page.locator('.li-ac-jev-chip');
    await expect(chips).toHaveCount(2);
    await expect(page.locator('.li-ac-jev-chip[data-jev-category="relevant"]')).toBeVisible();
    // Excluded post collapses to a thin strip (not removed)
    const hiddenToggle = page.locator('#li-ac-jev-hidden-toggle');
    await expect(hiddenToggle).toContainText('Peek AI-collapsed (1)');
    // Cost line tracks the session
    await expect(page.locator('#li-ac-llm-cost')).toContainText('1 req');
    // Found panel is a simple relevant-post list (no manual tabs)
    await expect(page.locator('#li-ac-tabbar')).toBeHidden();
    await expect(page.locator('#li-ac-section-kw')).toContainText('Relevant posts');
    await expect(page.locator('#li-ac-kw-list [data-key]')).toHaveCount(1);
    // Peek reveals, second click re-hides
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Collapse again (1)');
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Peek AI-collapsed (1)');
    await page.screenshot({ path: 'artifacts/jev-mode-chips.png', fullPage: false });
  });

  test('user can add a category with its own action and criteria', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      posts: [{ text: 'React hiring post with body' }]
    });
    await fp.setStorage({ jevMode: true });
    await fp.feedScan();

    // one default bucket, user-owned
    await expect(page.locator('#li-ac-jev-cat-editor [data-cat-row]')).toHaveCount(1);
    await expect(page.locator('#li-ac-jev-prompt-preview')).toContainText('Classify the quoted post into exactly one category.');

    await page.locator('#li-ac-jev-cat-add').click();
    await expect(page.locator('#li-ac-jev-cat-editor [data-cat-row]')).toHaveCount(2);

    const rows = page.locator('#li-ac-jev-cat-editor [data-cat-row]');
    const second = rows.nth(1);
    const crit = second.locator('[data-cat-criteria]');
    await crit.fill('Java-heavy posts');
    await crit.blur();
    await second.locator('[data-cat-action]').selectOption('collapse');
    await expect(page.locator('#li-ac-jev-prompt-preview')).toContainText('Java-heavy posts');
    await expect(page.locator('#li-ac-jev-saved')).toContainText(/saved|action/i);
  });
});
