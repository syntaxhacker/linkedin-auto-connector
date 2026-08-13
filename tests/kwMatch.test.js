'use strict';

/**
 * kwMatch(text, kw) — EXCLUDE keyword matching.
 * Contract: plain substring match of the lowercased keyword. Literal ".net"
 * must match "asp.net" but never "internet", "network", "connect", "tenet".
 */

describe('kwMatch (exclude keywords — literal substring)', () => {
  test('.net matches "asp.net developer"', () => {
    expect(global.__LI.kwMatch('asp.net developer', '.net')).toBe(true);
  });

  test('.net matches ".net core"', () => {
    expect(global.__LI.kwMatch('.net core', '.net')).toBe(true);
  });

  test('.net matches a bare ".net"', () => {
    expect(global.__LI.kwMatch('.net', '.net')).toBe(true);
  });

  test('.net matches "x.net library"', () => {
    expect(global.__LI.kwMatch('x.net library', '.net')).toBe(true);
  });

  test('.net does NOT match "internet scale"', () => {
    expect(global.__LI.kwMatch('internet scale', '.net')).toBe(false);
  });

  test('.net does NOT match "network engineer"', () => {
    expect(global.__LI.kwMatch('network engineer', '.net')).toBe(false);
  });

  test('.net does NOT match "connect"', () => {
    expect(global.__LI.kwMatch('connect', '.net')).toBe(false);
  });

  test('.net does NOT match "tenet"', () => {
    expect(global.__LI.kwMatch('tenet', '.net')).toBe(false);
  });

  test('.net does NOT match "cabinet"', () => {
    expect(global.__LI.kwMatch('cabinet', '.net')).toBe(false);
  });

  test('.net does NOT match "dotnet core"', () => {
    expect(global.__LI.kwMatch('dotnet core', '.net')).toBe(false);
  });

  test('keyword case-insensitivity: ".NET" keyword matches "asp.net developer"', () => {
    expect(global.__LI.kwMatch('asp.net developer', '.NET')).toBe(true);
  });

  test('mixed-case keyword ".NeT" still matches', () => {
    expect(global.__LI.kwMatch('asp.net developer', '.NeT')).toBe(true);
  });

  test('regex metacharacters are literal, not interpreted: "c++" matches "we use c++"', () => {
    expect(global.__LI.kwMatch('we use c++ daily', 'c++')).toBe(true);
  });

  test('"c++" keyword does not match a plain "c"', () => {
    expect(global.__LI.kwMatch('c programming', 'c++')).toBe(false);
  });

  test('"node.js" matches "node.js runtime"', () => {
    expect(global.__LI.kwMatch('node.js runtime', 'node.js')).toBe(true);
  });

  test('"react.js" matches "we use react.js"', () => {
    expect(global.__LI.kwMatch('we use react.js', 'react.js')).toBe(true);
  });

  test('"react.js" does NOT match "reactjs" (missing the literal dot)', () => {
    expect(global.__LI.kwMatch('reactjs', 'react.js')).toBe(false);
  });

  test('"node.js" does NOT match "nodejs" (dot is literal)', () => {
    expect(global.__LI.kwMatch('nodejs', 'node.js')).toBe(false);
  });

  test('plain word "qa" matches a standalone QA role but NOT a name containing "qa"', () => {
    expect(global.__LI.kwMatch('QA manager for our team', 'qa')).toBe(true);
    expect(global.__LI.kwMatch('Naeem Qaid celebrates', 'qa')).toBe(false);
    expect(global.__LI.kwMatch('quality assurance engineer', 'qa')).toBe(false);
  });

  test('plain word "opt" matches OPT but NOT "optical"', () => {
    expect(global.__LI.kwMatch('OPT visa sponsorship available', 'opt')).toBe(true);
    expect(global.__LI.kwMatch('optical materials for LED', 'opt')).toBe(false);
  });

  test('plain word "python" does not match inside "hypothetical"', () => {
    expect(global.__LI.kwMatch('we need python skills', 'python')).toBe(true);
    expect(global.__LI.kwMatch('a hypothetical scenario', 'python')).toBe(false);
  });

  test('punctuated keyword ".net" still matches inside "ASP.NET" (substring kept)', () => {
    expect(global.__LI.kwMatch('ASP.NET developer', '.net')).toBe(true);
  });

  test('empty keyword returns false for non-empty text (never matches everything)', () => {
    expect(global.__LI.kwMatch('asp.net developer', '')).toBe(false);
  });

  test('empty keyword returns false even for text containing empty-ish tokens', () => {
    expect(global.__LI.kwMatch('Feed post', '')).toBe(false);
  });
});
