// options.js
const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg, ok = true) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (ok ? 'ok' : 'err');
}

async function load() {
  const o = await chrome.storage.local.get('config');
  const c = o.config || {};
  $('email').value = c.email || '';
  if (c.password) {
    try { $('password').value = atob(c.password); } catch (e) { $('password').value = ''; }
  }
  if (c.officeLat != null) $('lat').value = c.officeLat;
  if (c.officeLng != null) $('lng').value = c.officeLng;
  $('radius').value = c.radius || 150;
  $('enabled').checked = c.enabled !== false;
  $('sel').value = c.checkinSelector || '';
}

async function save() {
  const lat = $('lat').value.trim();
  const lng = $('lng').value.trim();
  const cfg = {
    email: $('email').value.trim(),
    password: btoa($('password').value), // light local obfuscation (not encryption)
    officeLat: lat === '' ? null : parseFloat(lat),
    officeLng: lng === '' ? null : parseFloat(lng),
    radius: parseInt($('radius').value, 10) || 150,
    enabled: $('enabled').checked,
    checkinSelector: $('sel').value.trim()
  };

  const prev = (await chrome.storage.local.get('config')).config || {};
  if (prev.lastCheckinDate) cfg.lastCheckinDate = prev.lastCheckinDate;

  if (!cfg.email || !$('password').value) {
    setStatus('Enter both email and password first.', false);
    return;
  }
  await chrome.storage.local.set({ config: cfg });
  chrome.runtime.sendMessage({ type: 'configSaved' }); // re-arm update alarm + check now
  setStatus('Saved. You\u2019re all set.', true);
}

$('useLoc').addEventListener('click', () => {
  setStatus('Getting your location…', true);
  if (!navigator.geolocation) {
    setStatus('Geolocation not available. Enter lat/long manually.', false);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      $('lat').value = p.coords.latitude.toFixed(6);
      $('lng').value = p.coords.longitude.toFixed(6);
      setStatus('Location captured. Don\u2019t forget to Save.', true);
    },
    (err) => setStatus('Could not get location: ' + err.message + '. Enter manually.', false),
    { enableHighAccuracy: true, timeout: 15000 }
  );
});

$('save').addEventListener('click', save);

$('test').addEventListener('click', async () => {
  await save();
  chrome.runtime.sendMessage({ type: 'manualCheckin' });
  setStatus('Running a test check-in… watch the new tab.', true);
});

load();
