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
    await expect(hiddenToggle).toContainText('Show hidden (1)');
    // Cost line tracks the session
    await expect(page.locator('#li-ac-llm-cost')).toContainText('1 req');
    // Peek reveals, second click re-hides
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Hide again (1)');
    await hiddenToggle.click();
    await expect(hiddenToggle).toContainText('Show hidden (1)');
    await page.screenshot({ path: 'artifacts/jev-mode-chips.png', fullPage: false });
  });

  test('prompt autofill fills from keywords and saves', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      posts: [{ text: 'React hiring post with body' }]
    });
    await fp.setStorage({ includeKeywords: ['react'], excludeKeywords: ['intern'] });
    await fp.feedScan();

    const prompt = page.locator('#li-ac-jev-prompt');
    await expect(prompt).toHaveValue('');
    await page.locator('#li-ac-jev-autofill').click();
    await expect(prompt).toHaveValue(/react/i);
    await expect(page.locator('#li-ac-jev-saved')).toContainText(/autofilled/i);
  });
});
