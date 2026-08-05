'use strict';

/**
 * scanButtons() — scans the page for Connect/Invite affordances.
 *   Pattern A: <a href*="search-custom-invite"> with text exactly "Connect"
 *              inside a [role="listitem"] card (profile search results).
 *   Pattern B: <button aria-label="Invite <name> to connect"> (company pages).
 * Skips hidden elements, 3rd+ degree connections, and Intern bios.
 * Returns the number of queued entries; skipped entries bump getCounts().skipped.
 */

const { buildPatternACard, buildPatternBButton, resetState } = require('./helpers');

describe('scanButtons — Pattern A (search-custom-invite anchors)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState(); // zero the module-level skipped/connected counters
  });

  test('finds a Connect anchor inside a [role="listitem"] card', () => {
    buildPatternACard({ name: 'John Doe', vanity: 'johndoe' });
    expect(global.__LI.scanButtons()).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('skips anchors whose text is not exactly "Connect"', () => {
    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.textContent = 'Follow';
    expect(global.__LI.scanButtons()).toBe(0);
  });

  test('skips a 3rd-degree card and increments the skipped counter', () => {
    buildPatternACard({ name: 'Jane Doe', degreeText: '3rd+ connection' });
    expect(global.__LI.scanButtons()).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
  });

  test('skips a hidden anchor (offsetParent null) without marking it skipped', () => {
    buildPatternACard({ name: 'John Doe', visible: false });
    expect(global.__LI.scanButtons()).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('returns 0 when the page has no candidate anchors', () => {
    expect(global.__LI.scanButtons()).toBe(0);
  });
});

describe('scanButtons — Pattern B (Invite ... to connect buttons)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
  });

  test('finds a button with aria-label "Invite John Doe to connect"', () => {
    buildPatternBButton({ label: 'Invite John Doe to connect' });
    expect(global.__LI.scanButtons()).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('skips a button whose aria-label is not "Invite ... to connect"', () => {
    buildPatternBButton({ label: 'Invite John Doe' });
    expect(global.__LI.scanButtons()).toBe(0);
  });

  test('skips a 3rd-degree button via ancestor text within 4 parent levels', () => {
    const wrapper = document.createElement('div');
    wrapper.textContent = 'Jane Smith · 3rd+ degree';
    buildPatternBButton({ label: 'Invite Jane Smith to connect', wrapper });
    expect(global.__LI.scanButtons()).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
  });

  test('skips an Intern via ancestor text within 4 parent levels', () => {
    const wrapper = document.createElement('div');
    wrapper.textContent = 'Software Engineering Intern at Acme';
    buildPatternBButton({ label: 'Invite Intern Kid to connect', wrapper });
    expect(global.__LI.scanButtons()).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
  });

  test('does not skip a button when the Intern text is beyond 4 parent levels', () => {
    // Intern text lives in the 5th-level container; the button is nested 4
    // levels below it, so the skip-walk (4 parents max) never reaches it.
    const outer = document.createElement('div');
    outer.textContent = 'Software Engineering Intern at Acme';
    const level1 = document.createElement('div');
    const level2 = document.createElement('div');
    const level3 = document.createElement('div');
    const level4 = document.createElement('div');
    level1.appendChild(level2);
    level2.appendChild(level3);
    level3.appendChild(level4);
    outer.appendChild(level1);

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Invite Jane Smith to connect');
    level4.appendChild(btn);
    document.body.appendChild(outer);

    expect(global.__LI.scanButtons()).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('skips a hidden button (offsetParent null)', () => {
    buildPatternBButton({ label: 'Invite John Doe to connect', visible: false });
    expect(global.__LI.scanButtons()).toBe(0);
  });

  test('M4: with a card boundary, page text beyond the card is ignored', () => {
    // The card is a [role="listitem"]; the Intern text lives ABOVE the card
    // (page-level), so the bounded walk must not read it.
    const page = document.createElement('div');
    page.textContent = 'Some Intern elsewhere on the page';
    const card = document.createElement('div');
    card.setAttribute('role', 'listitem');
    page.appendChild(card);
    document.body.appendChild(page);

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Invite John Doe to connect');
    card.appendChild(btn);

    expect(global.__LI.scanButtons()).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('M4: a card containing "3rd" text still skips (bounded to the card)', () => {
    const card = document.createElement('div');
    card.setAttribute('role', 'listitem');
    card.textContent = 'Jane Smith · 3rd degree';
    document.body.appendChild(card);

    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Invite Jane Smith to connect');
    card.appendChild(btn);

    expect(global.__LI.scanButtons()).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
  });
});

describe('scanButtons — combined behavior', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState();
  });

  test('queues entries from both patterns in one scan', () => {
    buildPatternACard({ name: 'John Doe' });
    buildPatternBButton({ label: 'Invite Jane Smith to connect' });
    expect(global.__LI.scanButtons()).toBe(2);
  });

  test('counts only the connectable entries when skips are mixed in', () => {
    buildPatternACard({ name: 'John Doe' });
    buildPatternACard({ name: 'Mark Lee', degreeText: '3rd+ connection' });

    // Nest the connectable Pattern B button 4 levels deep so its skip-walk
    // stops before document.body (which contains the Intern wrapper text).
    const janeNest = document.createElement('div');
    const janeL2 = document.createElement('div');
    const janeL3 = document.createElement('div');
    const janeL4 = document.createElement('div');
    janeNest.appendChild(janeL2);
    janeL2.appendChild(janeL3);
    janeL3.appendChild(janeL4);
    const janeBtn = document.createElement('button');
    janeBtn.setAttribute('aria-label', 'Invite Jane Smith to connect');
    janeL4.appendChild(janeBtn);
    document.body.appendChild(janeNest);

    const internWrap = document.createElement('div');
    internWrap.textContent = 'Intern';
    buildPatternBButton({ label: 'Invite Intern Kid to connect', wrapper: internWrap });

    expect(global.__LI.scanButtons()).toBe(2);
    expect(global.__LI.getCounts().skipped).toBe(2);
  });
});
