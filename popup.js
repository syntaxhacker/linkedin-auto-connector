const $ = id => document.getElementById(id);
let tabUrl = '';

function send(msg, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) { $('log').textContent = '⚠ No active tab'; return; }
    tabUrl = tabs[0].url || '';
    chrome.tabs.sendMessage(tabs[0].id, msg, response => {
      if (chrome.runtime.lastError) {
        if (tabUrl.includes('linkedin.com')) $('log').textContent = '⚠ Reload the page (F5) to activate extension.';
        else $('log').textContent = '⚠ Not on LinkedIn. Open a search page.';
        return;
      }
      if (cb) cb(response);
    });
  });
}

function updateUI(s) {
  if (!s) return;
  $('count-ok').textContent = s.connected || 0;
  $('count-skip').textContent = s.skipped || 0;
  const dot = $('status-dot'); dot.className = '';
  if (s.running) { dot.classList.add('active'); $('status-text').textContent = 'Running...'; }
  else { dot.classList.remove('active'); $('status-text').textContent = ''; }
}

function saveDelay() {
  const min = parseInt($('delay-min').value, 10) || 1500;
  const max = parseInt($('delay-max').value, 10) || 3000;
  if (min >= 500 && max >= min) chrome.storage.sync.set({ delayMin: min, delayMax: max });
}

// Load saved delay
chrome.storage.sync.get({
  delayMin: 1500, delayMax: 3000
}, opts => {
  $('delay-min').value = opts.delayMin;
  $('delay-max').value = opts.delayMax;
});

$('delay-min').addEventListener('change', saveDelay);
$('delay-max').addEventListener('change', saveDelay);

$('btn-search').addEventListener('click', () => {
  send({ type: 'SCAN' }, resp => {
    if (resp) $('log').textContent = resp.count > 0
      ? '🔍 Found ' + resp.count + ' Connect buttons — highlighted!'
      : '🔍 No Connect buttons found.';
  });
});

$('btn-start').addEventListener('click', () => {
  const min = parseInt($('delay-min').value, 10) || 1500;
  const max = parseInt($('delay-max').value, 10) || 3000;
  send({ type: 'START', delayMin: min, delayMax: max }, resp => {
    if (resp && resp.ok) $('log').textContent = '▶ Connecting...';
    else if (resp && !resp.ok) $('log').textContent = '⚠ Click Search first to find buttons.';
  });
});

$('btn-stop').addEventListener('click', () => {
  send({ type: 'STOP' });
  $('log').textContent = '⏹ Stopped.';
});

$('btn-reset').addEventListener('click', () => {
  send({ type: 'RESET' });
  $('count-ok').textContent = '0';
  $('count-skip').textContent = '0';
  $('status-dot').className = '';
  $('status-text').textContent = '';
  $('log').textContent = '↺ Reset.';
});

// Auto-query status on open
send({ type: 'STATUS' }, updateUI);
