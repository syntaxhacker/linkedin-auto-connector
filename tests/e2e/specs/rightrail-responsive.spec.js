'use strict';
const { test, expect } = require('@playwright/test');
const { LinkedInFeedPage, fixtureHtml } = require('../pages/LinkedInFeedPage');

test.describe('Right-rail hide, 32vh heights, tab pill responsive', () => {
  test('right rail is hidden via CSS + imperative hide', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/search/', {
      html: fixtureHtml([{ text: 'hello bob@example.com' }])
        + '<div data-componentkey="SearchResults_SearchRightRail" id="rail1" style="display:block">ads</div>'
        + '<div class="search-reusable-search-right-rail" id="rail2" style="display:block">promo</div>'
    });
    await fp.feedScan();
    const rail1 = page.locator('#rail1');
    const rail2 = page.locator('#rail2');
    await expect(rail1).toBeHidden();
    await expect(rail2).toBeHidden();
    // CSS exists
    const css = await page.evaluate(() => document.getElementById('li-ac-styles')?.textContent || '');
    expect(css).toContain('SearchResults_SearchRightRail');
    expect(css).toContain('search-reusable-search-right-rail');
    expect(css).toContain('display: none !important');
  });

  test('kw/em lists 32vh when populated, hidden 40vh cap', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([
        { text: 'React senior no email' },
        { text: 'contact alice@example.com' },
      ])
    });
    await fp.setStorage({ includeKeywords: ['react'] });
    await fp.feedScan();
    const kwMin = await page.evaluate(() => document.getElementById('li-ac-kw-list')?.style.minHeight);
    const emMin = await page.evaluate(() => document.getElementById('li-ac-panel-list')?.style.minHeight);
    const hiddenMax = await page.evaluate(() => document.getElementById('li-ac-hidden-list')?.style.maxHeight);
    expect(kwMin).toBe('32vh');
    expect(emMin).toBe('32vh');
    expect(hiddenMax).toBe('40vh');
  });

  test('narrow: tabbar visible, active pill solid, inactive tint, wide: tabbar hidden and side-by-side', async ({ page }) => {
    const fp = new LinkedInFeedPage(page);
    await fp.goto('https://www.linkedin.com/feed/', {
      html: fixtureHtml([{ text: 'hello bob@example.com' }])
    });
    await fp.feedScan();
    // narrow default (1280px playwright default <1300? actually 1280 width, but we force)
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    let tabbarDisplay = await page.evaluate(() => document.getElementById('li-ac-tabbar')?.style.display);
    expect(tabbarDisplay).toBe('flex');
    let foundWidth = await page.evaluate(() => document.getElementById('li-ac-found-panel')?.style.width);
    expect(foundWidth).toBe('320px');

    const kwBgNarrow = await page.evaluate(() => document.getElementById('li-ac-tab-kw')?.style.background);
    // active kw should be solid (hex or rgb)
    expect(kwBgNarrow).toMatch(/fbbf24|251/);

    // switch to wide
    await page.setViewportSize({ width: 1500, height: 800 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await page.waitForTimeout(300);
    tabbarDisplay = await page.evaluate(() => document.getElementById('li-ac-tabbar')?.style.display);
    expect(tabbarDisplay).toBe('none');
    foundWidth = await page.evaluate(() => document.getElementById('li-ac-found-panel')?.style.width);
    expect(foundWidth).toBe('680px');
    const maxH = await page.evaluate(() => document.getElementById('li-ac-found-panel')?.style.maxHeight);
    expect(maxH).toBe('85vh');
  });
});
