const $ = id => document.getElementById(id);
let tabUrl = '';
let lastScanCount = 0;
const startBtn = $('btn-start'), searchBtn = $('btn-search'), stopBtn = $('btn-stop');
startBtn.disabled = true;
stopBtn.disabled = true;

let mounted = true;
window.addEventListener('beforeunload', () => { mounted = false; });

// On non-LinkedIn pages show ONLY the warning; hide the controls below.
function applyPageGate(url) {
  const onLinkedIn = !!url && url.includes('linkedin.com');
  document.getElementById('main').style.display = onLinkedIn ? '' : 'none';
  document.getElementById('not-linkedin').style.display = onLinkedIn ? 'none' : 'block';
}

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!mounted || !tabs[0]) return;
  applyPageGate(tabs[0].url || '');
});

// Status dot: 'idle' (grey) | 'active' (green, pulsing) | 'error' (red)
function setStatus(state, text) {
  const dot = $('status-dot');
  dot.className = state === 'active' ? 'active' : state === 'error' ? 'error' : '';
  $('status-text').textContent = text;
}

function send(msg, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!mounted) return;
    if (!tabs[0]) { $('log').textContent = '⚠ No active tab'; return; }
    tabUrl = tabs[0].url || '';
    chrome.tabs.sendMessage(tabs[0].id, msg, response => {
      if (!mounted) return;
      if (chrome.runtime.lastError) {
        const text = tabUrl.includes('linkedin.com')
          ? '⚠ Reload the page (F5) to activate extension.'
          : '⚠ Not on LinkedIn. Open a search page.';
        setStatus('error', text);
        $('log').textContent = text;
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
  setStatus(s.running ? 'active' : 'idle', s.running ? 'Running…' : 'Idle — open Search or Feed');
}

function saveDelay() {
  const min = parseInt($('delay-min').value, 10) || 1500;
  const max = parseInt($('delay-max').value, 10) || 3000;
  const WARNING = '⚠ Min delay must be ≤ max (both ≥ 500 ms)';
  if (min > max || min < 500) {
    $('delay-min').classList.add('invalid');
    $('delay-max').classList.add('invalid');
    $('log').textContent = WARNING;
    return;
  }
  $('delay-min').classList.remove('invalid');
  $('delay-max').classList.remove('invalid');
  chrome.storage.sync.set({ delayMin: min, delayMax: max });
  if ($('log').textContent === WARNING) $('log').textContent = '';
}

// Load saved delay
chrome.storage.sync.get({
  delayMin: 1500, delayMax: 3000
}, opts => {
  if (!mounted) return;
  $('delay-min').value = opts.delayMin;
  $('delay-max').value = opts.delayMax;
});

$('delay-min').addEventListener('change', saveDelay);
$('delay-max').addEventListener('change', saveDelay);

searchBtn.addEventListener('click', () => {
  send({ type: 'SCAN' }, resp => {
    if (resp) {
      lastScanCount = resp.count || 0;
      startBtn.disabled = lastScanCount <= 0;
      $('log').textContent = resp.count > 0
        ? '🔍 Found ' + resp.count + ' Connect buttons — highlighted!'
        : '🔍 No Connect buttons found.';
      send({ type: 'STATUS' }, updateUI); // refresh counters + clear stale error state
    }
  });
});

startBtn.addEventListener('click', () => {
  const min = parseInt($('delay-min').value, 10) || 1500;
  const max = parseInt($('delay-max').value, 10) || 3000;
  startBtn.disabled = true;
  searchBtn.disabled = true;
  stopBtn.disabled = false;
  send({ type: 'START', delayMin: min, delayMax: max }, resp => {
    if (resp && resp.ok) { setStatus('active', 'Connecting…'); $('log').textContent = '▶ Connecting...'; }
    else if (resp && !resp.ok) { setStatus('error', '⚠ Click Search first to find buttons.'); $('log').textContent = '⚠ Click Search first to find buttons.'; }
  });
});

stopBtn.addEventListener('click', () => {
  send({ type: 'STOP' });
  searchBtn.disabled = false;
  startBtn.disabled = lastScanCount <= 0;
  stopBtn.disabled = true;
  setStatus('idle', 'Idle — open Search or Feed');
  $('log').textContent = '⏹ Stopped.';
});

$('btn-reset').addEventListener('click', () => {
  send({ type: 'RESET' });
  searchBtn.disabled = false;
  startBtn.disabled = lastScanCount <= 0;
  stopBtn.disabled = true;
  $('count-ok').textContent = '0';
  $('count-skip').textContent = '0';
  setStatus('idle', '');
  $('log').textContent = '↺ Reset.';
});

// Auto-query status on open
send({ type: 'STATUS' }, resp => { if (!mounted) return; updateUI(resp); });
