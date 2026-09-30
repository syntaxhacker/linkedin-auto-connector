// LinkedIn Auto-Connector — background service worker.
// Provides the native right-click context menu ("Add to Include"/"Add to
// Exclude") and forwards the chosen action to the content script, which
// extracts keywords from the right-clicked post.

const MENU_INCLUDE = 'li-ac-add-include';
const MENU_EXCLUDE = 'li-ac-add-exclude';

// Keywords are DISABLED (AI categorize replaces them): the right-click
// "Add to Include/Exclude keywords" menu is not registered. Kept for rollback.
function ensureMenu() {
  return;
  // eslint-disable-next-line no-unreachable
  try {
    chrome.contextMenus.create({
      id: MENU_INCLUDE,
      title: 'Add post to Include keywords',
      contexts: ['page', 'selection', 'link']
    });
  } catch (e) { /* already exists */ }
  try {
    chrome.contextMenus.create({
      id: MENU_EXCLUDE,
      title: 'Add post to Exclude keywords',
      contexts: ['page', 'selection', 'link']
    });
  } catch (e) { /* already exists */ }
}

chrome.runtime.onInstalled.addListener(ensureMenu);
chrome.runtime.onStartup.addListener(ensureMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const kind = info.menuItemId === MENU_INCLUDE ? 'include'
             : info.menuItemId === MENU_EXCLUDE ? 'exclude' : null;
  if (!kind || !tab || tab.id == null) return;
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'ADD_KEYWORD_CONTEXT', kind }, () => {
      void chrome.runtime.lastError; // swallow "no receiving end" errors
    });
  } catch (e) { /* noop */ }
});

// LLM API relay: renderer fetches (content scripts included) are subject to
// CORS preflight, and some APIs (e.g. typesafe.ai) answer OPTIONS without an
// ACAO header, so the browser blocks the POST. The service worker is an
// extension process — no preflight — so it performs the POST and returns the
// raw text. Secrets pass through memory only; nothing is logged.
// Hardened: only our own LinkedIn contexts may call it, https URLs only,
// request bodies capped, responses capped (see MAX_RELAY_BYTES).
const MAX_RELAY_BYTES = 2 * 1024 * 1024;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'LLM_FETCH') return false;
  // Only our own extension contexts on LinkedIn (or the popup) may use it.
  const ownSender = sender && sender.id === chrome.runtime.id &&
    (!sender.tab || (sender.url && /^https?:\/\/([^/]*\.)?linkedin\.com\//.test(sender.url)));
  if (!ownSender) { sendResponse({ ok: false, status: 0, text: '', error: 'forbidden sender' }); return true; }
  let url;
  try { url = new URL(String(msg.url || '')); }
  catch (_) { sendResponse({ ok: false, status: 0, text: '', error: 'bad url' }); return true; }
  if (url.protocol !== 'https:') { sendResponse({ ok: false, status: 0, text: '', error: 'https only' }); return true; }
  if (typeof msg.body === 'string' && msg.body.length > 256 * 1024) {
    sendResponse({ ok: false, status: 0, text: '', error: 'body too large' });
    return true;
  }
  const headers = (msg.headers && typeof msg.headers === 'object' && !Array.isArray(msg.headers))
    ? msg.headers : {};
  // Egress allowlist: the default API is covered by static host_permissions;
  // any other host must have been granted by the user. This check lives in
  // the worker because content scripts have no access to chrome.permissions.
  if (url.hostname !== 'api.typesafe.ai') {
    (async () => {
      let granted = false;
      try {
        granted = await new Promise(res => {
          try { chrome.permissions.contains({ origins: [url.origin + '/*'] }, g => res(!!g)); }
          catch (_) { res(false); }
        });
      } catch (_) { granted = false; }
      if (!granted) {
        sendResponse({ ok: false, status: 0, text: '', error: 'host permission not granted for ' + url.origin });
        return;
      }
      doRelay(msg, url, headers, sendResponse);
    })();
    return true;
  }
  doRelay(msg, url, headers, sendResponse);
  return true;
});

// Performs the relayed POST and answers the sender. Kept separate so the
// permission gate above can decide whether to call it.
function doRelay(msg, url, headers, sendResponse) {
  const timeoutMs = Math.max(1000, Math.min(120000, Number(msg.timeoutMs) || 30000));
  const ctrl = new AbortController();
  const t = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, timeoutMs);
  (async () => {
    try {
      const resp = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: msg.body,
        signal: ctrl.signal,
      });
      // Cap the buffered body: a rogue endpoint must not OOM the worker.
      // Response bodies larger than the cap are cut (caller treats cuts as
      // unparseable → unsure/retries, never crashes).
      let text = '';
      let truncated = false;
      try {
        const reader = resp.body ? resp.body.getReader() : null;
        if (!reader) {
          text = (await resp.text()).slice(0, MAX_RELAY_BYTES);
        } else {
          let received = 0;
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value ? value.length : 0;
            if (received > MAX_RELAY_BYTES) { try { await reader.cancel(); } catch (_) {} truncated = true; break; }
            text += decoder.decode(value || new Uint8Array(), { stream: true });
          }
          text += decoder.decode(); // flush trailing bytes (split multibyte chars)
        }
      } catch (_) { truncated = true; }
      sendResponse({ ok: resp.ok, status: resp.status, text, truncated });
    } catch (e) {
      // Always include text so the relay contract is total: callers can tell
      // a relayed network failure apart from a missing worker.
      sendResponse({ ok: false, status: 0, text: '', error: String((e && e.message) || e) });
    } finally {
      clearTimeout(t);
    }
  })();
}
