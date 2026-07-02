// popup.js
const meta = document.getElementById('meta');
const updateBox = document.getElementById('updateBox');
const updateText = document.getElementById('updateText');

document.getElementById('now').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'manualCheckin' });
  meta.textContent = 'Starting check-in… watch the new tab.';
});

document.getElementById('opts').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('download').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'openDownload' });
});

(async () => {
  const o = await chrome.storage.local.get('config');
  const c = o.config || {};
  if (!c.email) {
    meta.textContent = 'Not set up yet — open Settings.';
  } else if (c.lastCheckinDate) {
    meta.textContent = 'Last auto check-in: ' + c.lastCheckinDate;
  } else {
    meta.textContent = 'Ready. Auto check-in on startup: ' + (c.enabled === false ? 'off (reminder)' : 'on') + '.';
  }

  try {
    const st = await chrome.runtime.sendMessage({ type: 'getUpdateStatus' });
    if (st && st.latest && st.latest.version) {
      updateText.innerHTML = 'New version <b>v' + st.latest.version + '</b> available (you have v' + st.installed + ').<br>' +
        (st.latest.notes ? st.latest.notes + '<br>' : '') +
        'Download, unzip over the old folder, then reload at chrome://extensions.';
      updateBox.style.display = 'block';
    }
  } catch (e) { /* ignore */ }
})();
