'use strict';

/**
 * scanEmails(posts) — extracts emails from each post's textContent using the
 * exported EMAIL_RE, deduping within a post. Malformed addresses (no domain,
 * single-letter TLD, digit after the TLD via lookahead, no @) are skipped.
 */

const { makePost } = require('./helpers');

describe('scanEmails', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('extracts a simple email from a post', () => {
    const post = makePost('Reach me at john.doe@example.com anytime');
    const hits = global.__LI.scanEmails([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].emails).toEqual(['john.doe@example.com']);
  });

  test('extracts multiple emails from a single post', () => {
    const post = makePost('contact a@b.com or c@d.org');
    const hits = global.__LI.scanEmails([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].emails).toEqual(['a@b.com', 'c@d.org']);
  });

  test('dedupes duplicate emails within a post', () => {
    const post = makePost('x@y.com then again x@y.com and once more x@y.com');
    const hits = global.__LI.scanEmails([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].emails).toEqual(['x@y.com']);
  });

  test('returns a hit referencing the post element', () => {
    const post = makePost('email: bob@example.com');
    const [hit] = global.__LI.scanEmails([post]);
    expect(hit.el).toBe(post);
  });

  test('skips posts with no email (no @ sign)', () => {
    const post = makePost('no email here, just words');
    expect(global.__LI.scanEmails([post])).toEqual([]);
  });

  test('skips an address with no domain (user@localhost)', () => {
    const post = makePost('local user@localhost');
    expect(global.__LI.scanEmails([post])).toEqual([]);
  });

  test('skips a single-letter TLD (user@example.c)', () => {
    const post = makePost('mail user@example.c');
    expect(global.__LI.scanEmails([post])).toEqual([]);
  });

  test('skips an address whose TLD ends in a digit via the lookahead (user@example.com9)', () => {
    const post = makePost('mail user@example.com9');
    expect(global.__LI.scanEmails([post])).toEqual([]);
  });

  test('skips an address whose TLD is partly a digit (user@example.co1)', () => {
    const post = makePost('mail user@example.co1');
    expect(global.__LI.scanEmails([post])).toEqual([]);
  });

  test('does not match an email glued to trailing alphanumerics (user@example.comx)', () => {
    // The TLD regex is greedy: "comx" is consumed as a longer lowercase TLD,
    // so the literal "user@example.com" is not reported.
    const post = makePost('mail user@example.comx');
    const hits = global.__LI.scanEmails([post]);
    expect(hits.map(h => h.emails[0])).not.toContain('user@example.com');
  });

  test('extracts emails from multiple posts without leaking the global regex lastIndex', () => {
    const p1 = makePost('first john@example.com done');
    const p2 = makePost('second jane@example.org here');
    const hits = global.__LI.scanEmails([p1, p2]);

    expect(hits.map(h => h.emails)).toEqual([
      ['john@example.com'],
      ['jane@example.org']
    ]);
    // The /g regex must be reset by the time scanning finishes.
    expect(global.__LI.EMAIL_RE.lastIndex).toBe(0);
  });

  test('returns hits only for posts that contain emails', () => {
    const withEmail = makePost('mail me at tom@example.com');
    const without = makePost('no contact info here');
    const hits = global.__LI.scanEmails([withEmail, without]);
    expect(hits).toHaveLength(1);
    expect(hits[0].el).toBe(withEmail);
  });

  test('returns an empty array for an empty post list', () => {
    expect(global.__LI.scanEmails([])).toEqual([]);
  });
});
