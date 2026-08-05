'use strict';

/**
 * getPosts() — returns the parentElement of every <h2> whose trimmed text is
 * exactly 'Feed post'; any other heading is ignored.
 */

const { makePost } = require('./helpers');

describe('getPosts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('returns the parent element of an h2 with exact text "Feed post"', () => {
    const post = makePost('some content');
    const posts = global.__LI.getPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(post);
  });

  test('ignores h2 elements with any other text', () => {
    const real = makePost('feed content');
    makePost('different heading', { h2Text: 'Some other heading' });
    makePost('plural heading', { h2Text: 'Feed posts' }); // close but not exact
    makePost('prefix', { h2Text: 'Feed post announcement' });

    const posts = global.__LI.getPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(real);
  });

  test('trims surrounding whitespace before matching', () => {
    makePost('content', { h2Text: '   Feed post   ' });
    expect(global.__LI.getPosts()).toHaveLength(1);
  });

  test('returns the direct parent element (h2 may be nested)', () => {
    const h2 = document.createElement('h2');
    h2.textContent = 'Feed post';
    const section = document.createElement('section');
    section.appendChild(h2);
    const outer = document.createElement('div');
    outer.appendChild(section);
    document.body.appendChild(outer);

    const posts = global.__LI.getPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(section); // parentElement of the h2, not the outermost
  });

  test('returns an empty array when no feed post markers exist', () => {
    const h2 = document.createElement('h2');
    h2.textContent = 'Feed post';
    // deliberately not attached to the document
    expect(global.__LI.getPosts()).toEqual([]);
  });

  test('excludes posts that are hidden (.li-ac-hidden)', () => {
    const visible = makePost('some content');
    const hidden = makePost('hidden content');
    hidden.classList.add('li-ac-hidden');

    const posts = global.__LI.getPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBe(visible);
    expect(posts).not.toContain(hidden);
  });
});
