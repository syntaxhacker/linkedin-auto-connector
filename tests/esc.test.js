'use strict';

/**
 * esc(kw) — escapes every regex metacharacter so a keyword is treated
 * literally when embedded in a RegExp (used by wordMatch for INCLUDE keywords).
 */

describe('esc (regex metacharacter escaping)', () => {
  test('escapes every regex metacharacter: . * + ? ^ $ { } ( ) | [ ] \\', () => {
    const metachars = ['.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '\\', '^', '$'];
    for (const ch of metachars) {
      expect(global.__LI.esc(ch)).toBe('\\' + ch);
    }
  });

  test('escapes the dot in ".net"', () => {
    expect(global.__LI.esc('.net')).toBe('\\.net');
  });

  test('escapes every plus in "c++"', () => {
    expect(global.__LI.esc('c++')).toBe('c\\+\\+');
  });

  test('escapes both dots in "node.js"', () => {
    expect(global.__LI.esc('node.js')).toBe('node\\.js');
  });

  test('leaves plain alphanumeric keywords untouched', () => {
    expect(global.__LI.esc('react')).toBe('react');
  });

  test('escaped dot matches only a literal dot (not any character)', () => {
    const re = new RegExp(global.__LI.esc('a.b'));
    expect(re.test('a.b')).toBe(true);
    expect(re.test('axb')).toBe(false);
    expect(re.test('a_b')).toBe(false);
  });

  test('escaped "c++" builds a valid literal regex (does not throw)', () => {
    const re = new RegExp(global.__LI.esc('c++'));
    expect(() => re.test('c++')).not.toThrow();
    expect(re.test('c++')).toBe(true);
    expect(re.test('c')).toBe(false);
  });

  test('escaped parenthesis/keyword builds a valid regex', () => {
    const re = new RegExp(global.__LI.esc('(remote)'));
    expect(re.test('(remote)')).toBe(true);
    expect(re.test('remote')).toBe(false);
  });
});
