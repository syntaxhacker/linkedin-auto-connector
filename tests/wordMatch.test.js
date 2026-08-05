'use strict';

/**
 * wordMatch(text, kw) — INCLUDE keyword matching.
 * Contract: keyword must appear as a whole word (word boundaries on
 * non-alphanumeric characters or string edges), with regex metacharacters
 * escaped. "react" must match "React Developer" but never "reactions",
 * "preact", or "ReactJS".
 */

describe('wordMatch (include keywords — word boundaries)', () => {
  test('"react" matches "React Developer"', () => {
    expect(global.__LI.wordMatch('React Developer', 'react')).toBe(true);
  });

  test('"react" matches "I love react"', () => {
    expect(global.__LI.wordMatch('I love react', 'react')).toBe(true);
  });

  test('"react" matches "react!" (punctuation boundary)', () => {
    expect(global.__LI.wordMatch('react!', 'react')).toBe(true);
  });

  test('"react" matches "node react 19"', () => {
    expect(global.__LI.wordMatch('node react 19', 'react')).toBe(true);
  });

  test('"react" does NOT match "reactions"', () => {
    expect(global.__LI.wordMatch('reactions', 'react')).toBe(false);
  });

  test('"react" does NOT match "preact"', () => {
    expect(global.__LI.wordMatch('preact', 'react')).toBe(false);
  });

  test('"react" does NOT match "ReactJS" (no boundary after "t")', () => {
    expect(global.__LI.wordMatch('ReactJS', 'react')).toBe(false);
  });

  test('"react" does NOT match "reactive"', () => {
    expect(global.__LI.wordMatch('reactive systems', 'react')).toBe(false);
  });

  test('"c++" matches "C++ engineer" without a regex error (metachars escaped)', () => {
    expect(() => global.__LI.wordMatch('C++ engineer', 'c++')).not.toThrow();
    expect(global.__LI.wordMatch('C++ engineer', 'c++')).toBe(true);
  });

  test('"node.js" matches "Node.js developer"', () => {
    expect(global.__LI.wordMatch('Node.js developer', 'node.js')).toBe(true);
  });

  test('"node.js" does NOT match "nodejs" (dot must be literal)', () => {
    expect(global.__LI.wordMatch('nodejs', 'node.js')).toBe(false);
  });

  test('empty keyword returns false without throwing', () => {
    expect(() => global.__LI.wordMatch('React Developer', '')).not.toThrow();
    expect(global.__LI.wordMatch('React Developer', '')).toBe(false);
  });
});
