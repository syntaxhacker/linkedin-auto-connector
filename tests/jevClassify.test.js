'use strict';

/**
 * Jev classification pipeline — unseen posts are batched to the TypeSafe/Jev
 * decisions API (one question per post, text embedded) and get a category
 * chip. Mirrors lib/jev.py classify(): same endpoint, model, and shape.
 */

const { makePost } = require('./helpers');

function mockFetchAnswers(answers) {
  return jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ answers }),
      text: () => Promise.resolve(JSON.stringify({ answers })),
    })
  );
}

describe('jev classify', () => {
  let realFetch;

  beforeEach(() => {
    document.body.innerHTML = '';
    realFetch = global.fetch;
    global.__LI.setCfg({
      includeKeywords: ['react'],
      excludeKeywords: ['intern'],
      jevPrompt: '',
      jevMinConfidence: 0.7,
      llmMinRunGapMs: 0,
      jevCategories: [
        { id: 'relevant', label: 'relevant', criteria: '', action: 'expand' },
        { id: 'excluded', label: 'excluded', criteria: '', action: 'collapse' },
      ],
    });
    global.__LI.resetLlmSession();
    global.__LI.resetLlmDaily();
    global.__LI.jevReset();
    global.__LI.setJevApiKey('test-key-123');
  });

  afterEach(() => {
    global.fetch = realFetch;
    global.__LI.setJevApiKey('');
    global.__LI.jevReset();
  });

  test('buildJevQuestions embeds truncated post text with cN ids and criteria', () => {
    const post = makePost('React hiring post with some body text here');
    const { questions, items } = global.__LI.buildJevQuestions([post]);
    expect(Object.keys(questions)).toEqual(['c0']);
    expect(questions.c0.type).toBe('choice');
    expect(questions.c0.instructions).toMatch(/React hiring post/);
    expect(questions.c0.criteria).toEqual(global.__LI.buildJevCategories());
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('c0');
    expect(items[0].el).toBe(post);
  });

  test('truncates post text to JEV_TEXT_MAX chars in the question', () => {
    const long = 'x'.repeat(600);
    const post = makePost(long);
    const { questions } = global.__LI.buildJevQuestions([post]);
    expect(questions.c0.instructions).not.toMatch(/x{550}/);
    expect(questions.c0.instructions).toMatch(/x{400}/);
    expect(global.__LI.JEV_TEXT_MAX).toBe(500);
  });

  test('posts to the TypeSafe endpoint with Bearer key and jev-latest model', async () => {
    const post = makePost('React hiring post');
    global.fetch = mockFetchAnswers({ c0: { choice: 'relevant', confidence: 0.92, probabilities: {} } });
    const res = await global.__LI.jevClassifyPosts([post]);
    expect(res.status).toBe('ok');
    expect(res.count).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(global.__LI.JEV_API_URL);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer test-key-123');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('jev-latest');
    expect(Object.keys(body.questions)).toEqual(['c0']);
    // winning post gets a chip with the category
    const chip = post.querySelector('.li-ac-jev-chip');
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('data-jev-category')).toBe('relevant');
  });

  test('skips classification when no API key is set', async () => {
    global.__LI.setJevApiKey('');
    const post = makePost('React hiring post');
    global.fetch = mockFetchAnswers({});
    const res = await global.__LI.jevClassifyPosts([post]);
    expect(res.status).toBe('no-key');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
  });

  test('does not re-send already categorized posts', async () => {
    const post = makePost('React hiring post');
    global.fetch = mockFetchAnswers({ c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } });
    await global.__LI.jevClassifyPosts([post]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    global.fetch = mockFetchAnswers({ c0: { choice: 'other', confidence: 0.9, probabilities: {} } });
    const res = await global.__LI.jevClassifyPosts([post]);
    expect(res.count).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
  });

  test('below-threshold confidence keeps the bucket and flags it', async () => {
    const post = makePost('Vague post about something');
    global.fetch = mockFetchAnswers({ c0: { choice: 'relevant', confidence: 0.3, probabilities: {} } });
    await global.__LI.jevClassifyPosts([post]);
    const chip = post.querySelector('.li-ac-jev-chip');
    expect(chip.getAttribute('data-jev-category')).toBe('relevant');
    expect(chip.title).toMatch(/low confidence/i);
  });

  test('missing answer for a question becomes unsure without throwing', async () => {
    const post = makePost('React hiring post');
    global.fetch = mockFetchAnswers({});
    const res = await global.__LI.jevClassifyPosts([post]);
    expect(res.status).toBe('ok');
    expect(post.querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('unsure');
  });

  test('batches more than JEV_BATCH posts into multiple calls with per-batch ids', async () => {
    const posts = [];
    for (let i = 0; i < 25; i++) posts.push(makePost('React post number ' + i + ' with enough body text to classify'));
    const batchAnswers = call => {
      const answers = {};
      const n = call === 0 ? 20 : 5;
      for (let i = 0; i < n; i++) {
        answers['c' + i] = call === 0
          ? { choice: 'relevant', confidence: 0.9, probabilities: {} }
          : { choice: 'excluded', confidence: 0.85, probabilities: {} };
      }
      return answers;
    };
    global.fetch = jest.fn(() => {
      const call = global.fetch.mock.calls.length - 1;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ answers: batchAnswers(call) }) });
    });
    const res = await global.__LI.jevClassifyPosts(posts);
    expect(res.count).toBe(25);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(Object.keys(firstBody.questions)).toHaveLength(global.__LI.JEV_BATCH);
    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(Object.keys(secondBody.questions)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    // batch-2 ids map to batch-2 answers, not batch-1's
    expect(posts[24].querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('excluded');
    expect(posts[0].querySelector('.li-ac-jev-chip').getAttribute('data-jev-category')).toBe('relevant');
  });

  test('fetch rejection surfaces an error status instead of throwing', async () => {
    const post = makePost('React hiring post');
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    const res = await global.__LI.jevClassifyPosts([post]);
    expect(res.status).toBe('error');
    expect(post.querySelector('.li-ac-jev-chip')).toBeNull();
  });

  test('skips dismissed, viewed, and text-less posts', async () => {
    const dismissed = makePost('React post dismissed');
    const viewed = makePost('React post viewed');
    const empty = makePost(null);
    const good = makePost('React post good with body');
    viewed.classList.add('li-ac-viewed');
    const dKey = global.__LI.postKey(dismissed);
    global.__LI.dismissedKeys().add('jev:' + dKey);
    const answers = { c0: { choice: 'relevant', confidence: 0.9, probabilities: {} } };
    global.fetch = mockFetchAnswers(answers);
    const unseen = global.__LI.jevUnseenPosts([dismissed, viewed, empty, good]);
    expect(unseen).toEqual([good]);
    global.__LI.dismissedKeys().clear();
  });
});
