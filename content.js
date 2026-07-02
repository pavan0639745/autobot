// content.js — runs on every hrlens.kredo.in page.
// Acts only when background says this tab is part of a run, so normal manual
// browsing of HRLens is never disturbed.

(async () => {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: 'getRunState' });
  } catch (e) { return; }
  if (!state || !state.active) return;

  const cfg = state.config || {};
  const runMode = state.runMode || 'checkin';

  const log = (...a) => console.log('[HRLens Auto]', ...a);

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 &&
      s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const findByText = (selector, re, notRe) => {
    const els = [...document.querySelectorAll(selector)];
    return els.find((el) => {
      const t = (el.innerText || el.textContent || el.value || '').trim();
      if (!re.test(t)) return false;
      if (notRe && notRe.test(t)) return false;
      return isVisible(el);
    });
  };

  const findCheckinButton = () => {
    if (cfg.checkinSelector) {
      const el = document.querySelector(cfg.checkinSelector);
      if (el && isVisible(el)) return el;
    }
    return findByText(
      'button, a, [role="button"], input[type="button"], input[type="submit"]',
      /\bcheck[\s\-]*in\b/i,
      /checked|check[\s\-]*out/i
    );
  };

  const alreadyCheckedIn = () => {
    const body = document.body.innerText || '';
    const hasCheckin = !!findCheckinButton();
    const looksIn = /checked\s*in/i.test(body) ||
      /\bcheck[\s\-]*out\b/i.test(body) ||
      /\bout\s+\d{1,2}:\d{2}/i.test(body);
    return !hasCheckin && looksIn;
  };

  const distMeters = (a, b) => {
    const R = 6371000, toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  const getPosition = () => new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (err) => rej(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });

  const setInput = (el, val) => {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const fireClick = (el) => {
    el.scrollIntoView({ block: 'center' });
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
  };

  const showBadge = (text, ok = true) => {
    const id = 'hrlens-auto-badge';
    const old = document.getElementById(id);
    if (old) old.remove();
    const d = document.createElement('div');
    d.id = id;
    d.textContent = text;
    Object.assign(d.style, {
      position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647',
      background: ok ? '#0f7a3d' : '#8a1f1f', color: '#fff',
      font: '600 14px/1.3 system-ui,Segoe UI,Roboto,sans-serif',
      padding: '10px 14px', borderRadius: '10px', maxWidth: '320px',
      boxShadow: '0 6px 20px rgba(0,0,0,.25)'
    });
    document.body.appendChild(d);
  };

  const notify = (title, message) =>
    chrome.runtime.sendMessage({ type: 'notify', title, message }).catch(() => {});
  const done = () =>
    chrome.runtime.sendMessage({ type: 'runDone' }).catch(() => {});
  const closeTab = () =>
    chrome.runtime.sendMessage({ type: 'closeTab' }).catch(() => {});
  const setDetected = (detected) =>
    chrome.runtime.sendMessage({ type: 'setDetected', detected }).catch(() => {});

  const prettyDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m');

  const modeLabel = (det) => {
    if (!det || !det.mode) return null;
    if (det.mode === 'office') return 'Work From Office';
    if (det.mode === 'home') return 'Work From Home' + (det.dist ? ' (' + prettyDist(det.dist) + ' from office)' : '');
    return null;
  };

  const path = location.href;
  const hasPassword = !!document.querySelector('input[type="password"]');
  const isLogin = /r=\/login/i.test(path) || (hasPassword && !/dashboard/i.test(path));

  // ---------- LOGIN PAGE ----------
  if (isLogin) {
    log('login page detected, mode:', runMode);

    // Stop the retry loop: bail out if login failed, or after 3 tries.
    const pageText = document.body.innerText || '';
    if (/too many login attempts/i.test(pageText)) {
      try { sessionStorage.removeItem('hrlens_login_attempts'); } catch (e) {}
      notify('HRLens', 'Locked out (too many attempts). Wait a few minutes and try again.');
      done();
      return;
    }
    if (/invalid|incorrect|do not match|couldn'?t sign/i.test(pageText)) {
      try { sessionStorage.removeItem('hrlens_login_attempts'); } catch (e) {}
      notify('HRLens', 'Login failed \u2014 check your email/password in Settings.');
      done();
      return;
    }
    let _tries = 0;
    try { _tries = parseInt(sessionStorage.getItem('hrlens_login_attempts') || '0', 10) || 0; } catch (e) {}
    if (_tries >= 3) {
      try { sessionStorage.removeItem('hrlens_login_attempts'); } catch (e) {}
      notify('HRLens', 'Login did not work after 3 tries. Check your password in Settings.');
      done();
      return;
    }
    try { sessionStorage.setItem('hrlens_login_attempts', String(_tries + 1)); } catch (e) {}

    let detected = { mode: 'unknown' };
    try {
      const pos = await getPosition();
      if (cfg.officeLat != null && cfg.officeLng != null) {
        const d = distMeters(pos, { lat: cfg.officeLat, lng: cfg.officeLng });
        detected = { mode: d <= (cfg.radius || 150) ? 'office' : 'home', dist: d };
        log('distance from office:', Math.round(d), 'm →', detected.mode);
      }
    } catch (err) {
      log('geolocation error', err);
      if (runMode === 'auto') {
        // can't verify office → be safe, don't check in silently
        notify('Location needed', 'Allow location for hrlens.kredo.in ("remember"), then reopen Chrome.');
        done();
        return;
      }
      // checkin mode: user tapped intentionally → proceed, location unknown
    }
    await setDetected(detected);

    // auto mode only proceeds when actually at office
    if (runMode === 'auto' && detected.mode !== 'office') {
      notify('Check-in skipped', 'You are not at office right now, so I did not check you in.');
      done();
      closeTab();
      return;
    }

    const email = document.querySelector(
      'input[type="email"], input[name*="email" i], input[placeholder*="@" i]'
    );
    const pass = document.querySelector('input[type="password"]');
    if (!email || !pass) {
      notify('HRLens', 'Login fields not found. Did the login page change?');
      done();
      return;
    }
    setInput(email, cfg.email || '');
    setInput(pass, cfg.password || '');

    const btn = findByText(
      'button, a, input[type="submit"], [role="button"]',
      /sign\s*in|log\s*in|login/i
    );
    if (btn) {
      fireClick(btn);
    } else if ((email.form || pass.form) && (email.form || pass.form).submit) {
      (email.form || pass.form).submit();
    }
    return; // navigates to dashboard → content.js re-runs there
  }

  // ---------- DASHBOARD ----------
  const isDashboard = /dashboard/i.test(path) ||
    !!findCheckinButton() ||
    /log\s*hours/i.test(document.body.innerText || '');

  if (isDashboard) {
    log('dashboard detected');
    await new Promise((r) => setTimeout(r, 1200));

    const label = modeLabel(state.detected);
    const suffix = label ? ' \u2014 ' + label : '';

    if (alreadyCheckedIn()) {
      showBadge('\u2713 Already checked in' + suffix, true);
      notify('HRLens', 'Already checked in today.' + (label ? ' ' + label + '.' : ''));
      done();
      return;
    }

    const btn = findCheckinButton();
    if (btn) {
      fireClick(btn);
      await new Promise((r) => setTimeout(r, 1500));
      showBadge('\u2713 Checked in' + suffix + ' \u2014 Good day', true);
      notify('HRLens', 'Checked in successfully.' + (label ? ' ' + label + '.' : '') + ' Good day.');
      chrome.runtime.sendMessage({ type: 'markCheckedIn' }).catch(() => {});
      done();
      return;
    }

    showBadge('Could not find the Check-in button', false);
    notify('HRLens', 'Auto check-in button not found. Set the exact button in options.');
    done();
    return;
  }

  done();
})();
