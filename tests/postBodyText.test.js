'use strict';

/**
 * Matching (keywords/emails/excludes) must read ONLY the post's own body — the
 * direct <p> children of the post card — not the author's profile headline,
 * "likes this" rows, reactions, or action buttons. Cards without a <p> (people
 * widgets, commentary-less shared cards) return '' and never match.
 */

const { makePost } = require('./helpers');

function buildCardWithHeader(headerText, bodyText) {
  const post = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Feed post';
  post.appendChild(h2);
  post.appendChild(document.createTextNode(' '));
  const header = document.createElement('div');
  header.textContent = headerText;
  post.appendChild(header);
  const p = document.createElement('p');
  p.textContent = bodyText;
  post.appendChild(p);
  document.body.appendChild(post);
  return post;
}

describe('postBodyText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns only the direct <p> body text', () => {
    const post = buildCardWithHeader('Chad Shaules • 3rd+ C.E.O. at Cornerstone Development Company', 'We are hiring a React engineer');
    expect(global.__LI.postBodyText(post)).toBe('We are hiring a React engineer');
  });

  test('returns empty string for a card with no <p> (people widget)', () => {
    const widget = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'Feed post';
    widget.appendChild(h2);
    const people = document.createElement('div');
    people.textContent = 'Recommended for youPan Wu Senior Data Scientist';
    widget.appendChild(people);
    document.body.appendChild(widget);
    expect(global.__LI.postBodyText(widget)).toBe('');
  });
});

describe('matching uses the post body only', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ includeKeywords: [], excludeKeywords: [], scanEmails: true });
    global.__LI.getRevealedHiddenKeys().clear();
  });

  test('scanKeywords ignores a profile headline and matches body words', () => {
    global.__LI.setCfg({ includeKeywords: ['senior', 'react'] });
    const post = buildCardWithHeader('Senior Full Stack Developer at Acme', 'We built a dashboard in react');
    const hits = global.__LI.scanKeywords([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].keywords).toEqual(['react']); // 'senior' only appeared in the headline
  });

  test('scanEmails ignores emails in the profile/header and finds the body email', () => {
    const post = buildCardWithHeader('Contact: head@acme.com', 'Apply at jobs@acme.com now');
    const hits = global.__LI.scanEmails([post]);
    expect(hits).toHaveLength(1);
    expect(hits[0].emails).toEqual(['jobs@acme.com']);
  });

  test('filterPosts does not hide a post for a headline-only exclude word', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const post = buildCardWithHeader('ASP.NET Architect at Contoso', 'Today was a quiet day at work');
    expect(global.__LI.filterPosts([post])).toBe(0);
    expect(global.__LI.getHiddenCount()).toBe(0);
  });

  test('filterPosts hides a post when the exclude word is in the body', () => {
    global.__LI.setCfg({ excludeKeywords: ['.net'] });
    const post = buildCardWithHeader('Some person', 'We use ASP.NET internally');
    expect(global.__LI.filterPosts([post])).toBe(1);
    expect(post.classList.contains('li-ac-hidden')).toBe(true);
  });

  test('a people widget without a body never matches', () => {
    global.__LI.setCfg({ includeKeywords: ['senior'], excludeKeywords: ['senior'] });
    const widget = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = 'Feed post';
    widget.appendChild(h2);
    const people = document.createElement('div');
    people.textContent = 'Recommended for youPan Wu Senior Data Scientist';
    widget.appendChild(people);
    document.body.appendChild(widget);

    expect(global.__LI.scanKeywords([widget])).toEqual([]);
    expect(global.__LI.scanEmails([widget])).toEqual([]);
    expect(global.__LI.filterPosts([widget])).toBe(0);
  });
});
