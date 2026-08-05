'use strict';

/**
 * expandPosts(posts) — clicks "…more" / "See more" / "...more" expansion
 * buttons inside each post when cfg.autoExpand is true. Returns the number of
 * buttons clicked; 0 when autoExpand is disabled.
 */

const { makePost } = require('./helpers');

const DEFAULTS = {
  autoExpand: true,
  scanEmails: true,
  includeKeywords: [],
  excludeKeywords: [],
  autoScroll: false,
  debug: false
};

function postWithButtons(buttonTexts) {
  const post = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = 'Feed post';
  post.appendChild(h2);
  for (const text of buttonTexts) {
    const b = document.createElement('button');
    b.textContent = text;
    post.appendChild(b);
  }
  document.body.appendChild(post);
  return post;
}

describe('expandPosts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    global.__LI.setCfg({ ...DEFAULTS });
  });

  test('clicks a "…more" button and returns the clicked count', () => {
    const post = postWithButtons(['…more']);
    expect(global.__LI.expandPosts([post])).toBe(1);
  });

  test('clicks "See more" (capitalized) and "see more" (lowercase)', () => {
    const p1 = postWithButtons(['See more']);
    expect(global.__LI.expandPosts([p1])).toBe(1);

    const p2 = postWithButtons(['see more']);
    expect(global.__LI.expandPosts([p2])).toBe(1);
  });

  test('clicks the dotted "...more" variant', () => {
    const post = postWithButtons(['...more']);
    expect(global.__LI.expandPosts([post])).toBe(1);
  });

  test('clicks every matching button across a post', () => {
    const post = postWithButtons(['…more', 'See more', 'Follow', '...more']);
    expect(global.__LI.expandPosts([post])).toBe(3);
  });

  test('does not click unrelated buttons', () => {
    const post = postWithButtons(['Follow', 'Connect', 'Like', 'Send']);
    expect(global.__LI.expandPosts([post])).toBe(0);
  });

  test('does not click "See more posts" (regex requires the string to end at "see more")', () => {
    const post = postWithButtons(['See more posts']);
    expect(global.__LI.expandPosts([post])).toBe(0);
  });

  test('dispatches a real click event that listeners observe', () => {
    const post = postWithButtons(['…more']);
    const btn = post.querySelector('button');
    let clicked = 0;
    btn.addEventListener('click', () => clicked++);

    expect(global.__LI.expandPosts([post])).toBe(1);
    expect(clicked).toBe(1);
  });

  test('returns 0 when autoExpand is disabled even with matching buttons', () => {
    global.__LI.setCfg({ autoExpand: false });
    const post = postWithButtons(['…more']);
    expect(global.__LI.expandPosts([post])).toBe(0);
  });

  test('returns 0 for posts without buttons', () => {
    const post = makePost('no buttons here');
    expect(global.__LI.expandPosts([post])).toBe(0);
  });

  test('returns 0 for an empty post list', () => {
    expect(global.__LI.expandPosts([])).toBe(0);
  });
});
