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
    await fp.setStorage({ jevMode: true, includeKeywords: ['react'] });
    await fp.feedScan();

    const chips = page.locator('.li-ac-jev-chip');
    await expect(chips).toHaveCount(2);
    await expect(page.locator('.li-ac-jev-chip[data-jev-category="relevant"]')).toBeVisible();
    // Excluded post collapses to a thin strip (not removed)
    const hiddenToggle = page.locator('#li-ac-jev-hidden-toggle');
    await expect(hiddenToggle).toContainText('Peek AI-collapsed (1)');
    // Cost line tracks the session
    await expect(page.locator('#li-ac-llm-cost')).toContainText('1 req');
    // Peek reveals, second click re-hides
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Collapse again (1)');
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Peek AI-collapsed (1)');
    await page.screenshot({ path: 'artifacts/jev-mode-chips.png', fullPage: false });
  });

  test('prompt autofill fills relevant/excluded cells and saves', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      posts: [{ text: 'React hiring post with body' }]
    });
    await fp.setStorage({ includeKeywords: ['react'], excludeKeywords: ['intern'], jevMode: true });
    await fp.feedScan();

    const relevant = page.locator('#li-ac-jev-cell-relevant');
    await expect(relevant).toHaveValue(/react/i);
    await expect(page.locator('#li-ac-jev-prompt-preview')).toContainText('Classify the quoted post into exactly one category.');
    await expect(page.locator('#li-ac-jev-prompt')).toHaveCount(0); // legacy textarea gone
    await relevant.fill('Senior fintech React only');
    await relevant.blur();
    await expect(page.locator('#li-ac-jev-saved')).toContainText(/saved/i);
    await expect(page.locator('#li-ac-jev-prompt-preview')).toContainText('Senior fintech React only');
  });
});
