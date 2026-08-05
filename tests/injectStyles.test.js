'use strict';

/**
 * injectStyles — adds a single <style id="li-ac-styles"> with the hover-to-expand
 * rule for .li-ac-hidden and the keyword highlight rule. Must be idempotent.
 */

describe('injectStyles (hover-to-expand CSS)', () => {
  beforeEach(() => {
    const existing = document.getElementById('li-ac-styles');
    if (existing) existing.remove();
  });

  test('injects the style element once', () => {
    global.__LI.injectStyles();
    const style = document.getElementById('li-ac-styles');
    expect(style).not.toBeNull();

    global.__LI.injectStyles();
    const styles = document.querySelectorAll('#li-ac-styles');
    expect(styles).toHaveLength(1);
  });

  test('contains a hover-to-expand rule for .li-ac-hidden', () => {
    global.__LI.injectStyles();
    const css = document.getElementById('li-ac-styles').textContent;
    expect(css).toContain('.li-ac-hidden {');
    expect(css).toContain('.li-ac-hidden:hover {');
    expect(css).toContain('max-height');
    expect(css).toContain('.li-ac-kw-hl');
  });
});
