'use strict';

/**
 * START message connect flow — exercises processNext() (dialog handling,
 * send-without-note, direct-connect, and failure paths) using fake timers.
 */

const { buildPatternACard, sendMessage, resetState } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

describe('START message connect flow (processNext)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetState(); // zero connected/skipped counters between tests
    global.__LI.setCfg({ ...DEFAULTS });
  });

  afterEach(() => {
    jest.useRealTimers();
    global.__LI.cleanup();
  });

  test('clicks "Send without note" in the dialog and increments connected', async () => {
    jest.useFakeTimers();

    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send without note';
    dialog.appendChild(sendBtn);
    document.body.appendChild(dialog);

    const { response } = sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    expect(response).toEqual({ ok: true });

    await jest.advanceTimersByTimeAsync(1000); // dialog poll finds it at ~300ms
    await jest.advanceTimersByTimeAsync(2000); // randomDelay + recursion drain

    expect(global.__LI.getCounts().connected).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('increments skipped when no dialog appears', async () => {
    jest.useFakeTimers();

    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    const { response } = sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    expect(response).toEqual({ ok: true });

    // Dialog poll runs its full 10×300ms budget, then the no-dialog branch
    // sleeps 500ms before counting the skip.
    await jest.advanceTimersByTimeAsync(3500); // 3000ms poll + 500ms fallback
    await jest.advanceTimersByTimeAsync(2000); // randomDelay + drain

    expect(global.__LI.getCounts().connected).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
  });

  test('counts a direct connect when the button text becomes "Pending"', async () => {
    jest.useFakeTimers();

    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });

    await jest.advanceTimersByTimeAsync(1000); // poll running, no dialog yet
    connect.textContent = 'Pending'; // LinkedIn flips the button after the click
    await jest.advanceTimersByTimeAsync(3000); // finish poll + 500ms fallback + drain

    expect(global.__LI.getCounts().connected).toBe(1);
    expect(global.__LI.getCounts().skipped).toBe(0);
  });

  test('skips and dismisses when the dialog has no send-without-note button', async () => {
    jest.useFakeTimers();

    const { connect } = buildPatternACard({ name: 'John Doe' });
    connect.addEventListener('click', e => e.preventDefault());

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const dismiss = document.createElement('button');
    dismiss.setAttribute('aria-label', 'Dismiss');
    dialog.appendChild(cancel);
    dialog.appendChild(dismiss);
    document.body.appendChild(dialog);

    let dismissed = 0;
    dismiss.addEventListener('click', () => dismissed++);

    sendMessage({ type: 'START', delayMin: 100, delayMax: 100 });
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);

    expect(global.__LI.getCounts().connected).toBe(0);
    expect(global.__LI.getCounts().skipped).toBe(1);
    expect(dismissed).toBe(1);
  });
});
