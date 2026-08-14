'use strict';

/**
 * Shared DOM fixture builders for the LinkedIn Auto-Connector content script
 * tests. content.js's getPosts/filterPosts/scanEmails operate on real DOM
 * elements (they query document and call p.remove()), so all fixtures are
 * attached to document.body.
 */

/**
 * Build a feed post: a div containing an <h2> with text 'Feed post' (the exact
 * marker getPosts looks for) plus an optional body paragraph. Attached to
 * document.body.
 */
function makePost(content, { h2Text = 'Feed post' } = {}) {
  const post = document.createElement('div');
  post.className = 'feed-post';

  const h2 = document.createElement('h2');
  h2.textContent = h2Text;
  post.appendChild(h2);

  // Real documents separate block-level nodes with whitespace text nodes.
  // Without this separator, textContent concatenates the marker and the body
  // ("Feed postReact…"), which breaks word-boundary keyword matching and lets
  // the email regex absorb the marker into the local part ("postx@y.com").
  post.appendChild(document.createTextNode(' '));

  if (content != null) {
    const p = document.createElement('p');
    p.textContent = content;
    post.appendChild(p);
  }

  document.body.appendChild(post);
  return post;
}

/**
 * Pattern A card: a [role="listitem"] containing a profile link and a Connect
 * anchor whose href contains "search-custom-invite" (LinkedIn search results).
 *
 * Options:
 *   name        -> text of the profile link (used for extracted connect name)
 *   vanity      -> vanityName query param on the Connect anchor href
 *   degreeText  -> extra card text (e.g. "3rd+ connection") for skip tests
 *   visible     -> false sets _offsetParent = null (simulates hidden element)
 */
function buildPatternACard({ name = 'John Doe', vanity = 'johndoe', degreeText = '', visible = true } = {}) {
  const card = document.createElement('div');
  card.setAttribute('role', 'listitem');

  const profileLink = document.createElement('a');
  profileLink.href = '/in/' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  profileLink.textContent = name;
  card.appendChild(profileLink);

  const connect = document.createElement('a');
  connect.textContent = 'Connect';
  connect.href =
    'https://www.linkedin.com/search/results/people/?vanityName=' +
    vanity +
    '&search-custom-invite=connect';
  card.appendChild(connect);

  if (degreeText) {
    const degree = document.createElement('span');
    degree.textContent = degreeText;
    card.appendChild(degree);
  }

  if (visible === false) connect._offsetParent = null;

  document.body.appendChild(card);
  return { card, connect, profileLink };
}

/**
 * Pattern B button: <button aria-label="Invite X to connect"> (company people
 * pages). Optionally nested inside a wrapper element to exercise the
 * 3rd-degree / Intern ancestor-text skip checks (which walk up 4 parents).
 *
 * Options:
 *   label    -> aria-label attribute
 *   wrapper  -> element to nest the button inside (appended to body)
 *   visible  -> false sets _offsetParent = null (simulates hidden element)
 */
function buildPatternBButton({ label = 'Invite John Doe to connect', wrapper = null, visible = true } = {}) {
  const btn = document.createElement('button');
  btn.setAttribute('aria-label', label);
  if (visible === false) btn._offsetParent = null;

  if (wrapper) {
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);
  } else {
    const parent = document.createElement('div');
    parent.appendChild(btn);
    document.body.appendChild(parent);
  }
  return btn;
}

/**
 * Drive a message through the chrome.runtime.onMessage listener captured by
 * the setup mock. Returns { response, responded }.
 */
function sendMessage(msg) {
  let response;
  let responded = false;
  global.__onMessage(msg, {}, r => {
    response = r;
    responded = true;
  });
  return { response, responded };
}

/**
 * Reset module-level state (connected/skipped counters, connect queue, badge,
 * autoScroll cfg) using the production RESET message. Needed because content.js
 * keeps its counters across tests within a file.
 */
function resetState() {
  sendMessage({ type: 'RESET' });
}

/**
 * Close both floating panels (control + found) if present. Panels have no
 * close button (minimize only), so tests remove the elements directly — the
 * next renderPanel sees the detached nodes and recreates fresh panels. Also
 * removes the floating bubble so no gate overlay lingers on it.
 */
function closePanels() {
  ['li-ac-panel', 'li-ac-found-panel', 'li-ac-bubble'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

module.exports = { makePost, buildPatternACard, buildPatternBButton, sendMessage, resetState, closePanels };
