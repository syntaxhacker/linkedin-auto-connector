// LinkedIn Auto-Connector — background service worker.
// Provides the native right-click context menu ("Add to Include"/"Add to
// Exclude") and forwards the chosen action to the content script, which
// extracts keywords from the right-clicked post.

const MENU_INCLUDE = 'li-ac-add-include';
const MENU_EXCLUDE = 'li-ac-add-exclude';

function ensureMenu() {
  try {
    chrome.contextMenus.create({
      id: MENU_INCLUDE,
      title: '🔗 Add post to Include keywords',
      contexts: ['page', 'selection', 'link']
    });
  } catch (e) { /* already exists */ }
  try {
    chrome.contextMenus.create({
      id: MENU_EXCLUDE,
      title: '🔗 Add post to Exclude keywords',
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
