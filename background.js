// background.js — service worker (MV3)
//
// >>> EDIT ONCE, HERE <<<  These are baked in for everyone. New colleagues do not
// need to type any URLs — they only enter email + password in Settings.
const DEFAULTS = {
  updateUrl: 'https://raw.githubusercontent.com/pavan0639745/autobot/main/version.json',
  downloadUrl: 'https://github.com/pavan0639745/autobot/archive/refs/heads/main.zip',
  checkIntervalMinutes: 15,
  // Optional: paste your office coordinates here once and push. Then colleagues
  // only enter email + password (office location comes from here).
  officeLat: null,   // e.g. 12.971600
  officeLng: null,   // e.g. 77.594600
  radius: 150
};

const SKEY = 'runstate';
const LOGIN_URL = 'https://hrlens.kredo.in/index.php?r=/login';
const REMINDER_ID = 'hrlens-reminder';
const UPDATE_ID = 'hrlens-update';
const UPDATE_ALARM = 'hrlens-update-check';

/* ---------------- run state (session) ---------------- */
async function getRun() {
  const o = await chrome.storage.session.get(SKEY);
  return o[SKEY] || { active: false };
}
async function setRun(v) { await chrome.storage.session.set({ [SKEY]: v }); }
async function patchRun(p) { const r = await getRun(); await setRun({ ...r, ...p }); }
async function clearRun() { await chrome.storage.session.remove(SKEY); }

/* ---------------- config (stored values fall back to DEFAULTS) ---------------- */
function withDefaults(stored) {
  const out = { ...stored };
  for (const k of Object.keys(DEFAULTS)) {
    const v = stored[k];
    if (v === undefined || v === null || v === '') out[k] = DEFAULTS[k];
  }
  return out;
}
async function getConfig() {
  const o = await chrome.storage.local.get('config');
  let c = withDefaults(o.config || {});
  if (c.password) {
    try { c = { ...c, password: atob(c.password) }; } catch (e) { /* ignore */ }
  }
  return c;
}

function notify(title, message) {
  chrome.notifications.create('', {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: title || 'HRLens', message: message || '', priority: 2
  });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ================= CHECK-IN ================= */
function showReminder() {
  chrome.notifications.create(REMINDER_ID, {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'HRLens \u2014 time to check in?',
    message: 'Tap "Check in now" and I\u2019ll log you in and check you in.',
    priority: 2, requireInteraction: true,
    buttons: [{ title: 'Check in now' }]
  });
}

async function startRun(runMode) {
  const cfg = await getConfig();
  if (!cfg.email || !cfg.password) {
    notify('Setup needed', 'Open the extension options and enter your HRLens email & password.');
    return;
  }
  if (runMode === 'auto' && (cfg.officeLat == null || cfg.officeLng == null)) {
    notify('Setup needed', 'Set your office location in the extension options.');
    return;
  }
  if (runMode === 'auto' && cfg.lastCheckinDate === todayStr()) return;

  const tab = await chrome.tabs.create({ url: LOGIN_URL, active: true });
  await setRun({ active: true, tabId: tab.id, runMode, config: cfg, detected: null });
}

/* ================= UPDATE NOTIFIER ================= */
function cmpVer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function setBadge(on) {
  try {
    await chrome.action.setBadgeText({ text: on ? 'NEW' : '' });
    if (on) await chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
  } catch (e) { /* ignore */ }
}

function showUpdateNotification(version, notes) {
  chrome.notifications.create(UPDATE_ID, {
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'HRLens \u2014 update available (v' + version + ')',
    message: (notes ? notes + '\n' : '') + 'Click Download to get the new version.',
    priority: 2, requireInteraction: true,
    buttons: [{ title: 'Download' }]
  });
}

async function checkForUpdate() {
  const cfg = await getConfig();
  if (!cfg.updateUrl) return;
  try {
    const url = cfg.updateUrl + (cfg.updateUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const remote = data.version;
    const installed = chrome.runtime.getManifest().version;
    if (!remote) return;

    if (cmpVer(remote, installed) > 0) {
      const latest = {
        version: remote,
        downloadUrl: data.download_url || cfg.downloadUrl || '',
        notes: data.notes || ''
      };
      await chrome.storage.local.set({ latestUpdate: latest });
      await setBadge(true);
      const seen = (await chrome.storage.local.get('lastNotifiedVersion')).lastNotifiedVersion;
      if (seen !== remote) {
        showUpdateNotification(remote, latest.notes);
        await chrome.storage.local.set({ lastNotifiedVersion: remote });
      }
    } else {
      await chrome.storage.local.remove('latestUpdate');
      await setBadge(false);
    }
  } catch (e) {
    console.log('[HRLens Auto] update check failed', e);
  }
}

async function openDownload() {
  const o = await chrome.storage.local.get('latestUpdate');
  const cfg = await getConfig();
  const url = (o.latestUpdate && o.latestUpdate.downloadUrl) || cfg.downloadUrl;
  if (url) chrome.tabs.create({ url });
  else notify('HRLens', 'No download link set.');
}

async function setupAlarm() {
  const cfg = await getConfig();
  const mins = Math.max(1, parseInt(cfg.checkIntervalMinutes, 10) || 15);
  await chrome.alarms.clear(UPDATE_ALARM);
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: mins, delayInMinutes: 0.1 });
}

/* ================= EVENTS ================= */
chrome.runtime.onInstalled.addListener(async () => { await setupAlarm(); checkForUpdate(); });

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  checkForUpdate();
  const o = await chrome.storage.local.get('config');
  const c = o.config || {};
  if (c.enabled === false) showReminder();   // reminder mode
  else startRun('auto');                      // silent auto mode
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForUpdate();
});

chrome.notifications.onButtonClicked.addListener((id) => {
  if (id === REMINDER_ID) { chrome.notifications.clear(REMINDER_ID); startRun('checkin'); }
  if (id === UPDATE_ID) { chrome.notifications.clear(UPDATE_ID); openDownload(); }
});
chrome.notifications.onClicked.addListener((id) => {
  if (id === REMINDER_ID) { chrome.notifications.clear(REMINDER_ID); startRun('checkin'); }
  if (id === UPDATE_ID) { chrome.notifications.clear(UPDATE_ID); openDownload(); }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const run = await getRun();
    switch (msg && msg.type) {
      case 'getRunState': {
        const active = !!(run.active && sender.tab && sender.tab.id === run.tabId);
        sendResponse({ active, config: run.config, runMode: run.runMode, detected: run.detected });
        return;
      }
      case 'setDetected': { await patchRun({ detected: msg.detected || null }); sendResponse({ ok: true }); return; }
      case 'notify': { notify(msg.title, msg.message); sendResponse({ ok: true }); return; }
      case 'closeTab': { if (sender.tab) chrome.tabs.remove(sender.tab.id).catch(() => {}); sendResponse({ ok: true }); return; }
      case 'runDone': { await clearRun(); sendResponse({ ok: true }); return; }
      case 'markCheckedIn': {
        const o = await chrome.storage.local.get('config');
        const c = o.config || {};
        c.lastCheckinDate = todayStr();
        await chrome.storage.local.set({ config: c });
        sendResponse({ ok: true }); return;
      }
      case 'manualCheckin': { await startRun('checkin'); sendResponse({ ok: true }); return; }
      case 'checkUpdateNow': { await checkForUpdate(); sendResponse({ ok: true }); return; }
      case 'openDownload': { await openDownload(); sendResponse({ ok: true }); return; }
      case 'configSaved': { await setupAlarm(); await checkForUpdate(); sendResponse({ ok: true }); return; }
      case 'getUpdateStatus': {
        const o = await chrome.storage.local.get('latestUpdate');
        sendResponse({ installed: chrome.runtime.getManifest().version, latest: o.latestUpdate || null });
        return;
      }
      default: sendResponse({ ok: false });
    }
  })();
  return true;
});
