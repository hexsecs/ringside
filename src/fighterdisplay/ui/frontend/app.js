const statusEl = document.getElementById('status');
const encodersEl = document.getElementById('encoders');
const portsEl = document.getElementById('ports');
const bankButtons = Array.from(document.querySelectorAll('.bank button'));
const settingsToggle = document.getElementById('settings-toggle');
const fullscreenToggle = document.getElementById('fullscreen-toggle');
const liveView = document.getElementById('live-view');
const midiSection = document.getElementById('midi-section');
const settingsSection = document.getElementById('settings-section');
const activePresetEl = document.getElementById('active-preset');
const livePresetTitleEl = document.getElementById('live-preset-title');
const displaySection = document.getElementById('display-section');
const showCCBtn = document.getElementById('toggle-show-cc');
const showValueBtn = document.getElementById('toggle-show-value');
const themeSystemBtn = document.getElementById('theme-system');
const themeLightBtn = document.getElementById('theme-light');
const themeDarkBtn = document.getElementById('theme-dark');
const bankPosAboveBtn = document.getElementById('bank-pos-above');
const bankPosBelowBtn = document.getElementById('bank-pos-below');
const presetSelect = document.getElementById('preset-select');
const dirtyFlagEl = document.getElementById('dirty-flag');
const presetSaveBtn = document.getElementById('preset-save');
const presetSaveCurrentBtn = document.getElementById('preset-save-current');
const presetLoadBtn = document.getElementById('preset-load');
const presetDownloadBtn = document.getElementById('preset-download');
const inSelect = document.getElementById('midi-in');
const outSelect = document.getElementById('midi-out');
const midiRefreshBtn = document.getElementById('midi-refresh');
const sendBankToggle = document.getElementById('send-bank-toggle');
const midiLearnBtn = document.getElementById('midi-learn');

// Web MIDI state
let midiAccess = null;
let midiIn = null;
let midiOut = null;
let echoLED = true; // echo CC back to Twister to drive LED rings
let ccMap = {}; // { bank: { encoder: cc } }
let chanMap = {}; // { bank: { encoder: channel (1..16) } }
let midiInMap = new Map();
let midiOutMap = new Map();
let midiLearn = false;
let learnTarget = null; // { bank, enc }

// Cache last known state/mapping for quick local reads
let latestState = null;
let latestMapping = null;
let isDirty = false;
let currentPreset = '';
let showCC = true;
let showValue = true;
let themeMode = 'system';
let prefersDarkMql = null;
let bankPos = 'above';
let modalOpening = false;

function isModalVisible() {
  const el = document.getElementById('cc-modal');
  return !!(el && !el.classList.contains('hidden'));
}

function scheduleOpen(enc) {
  if (isModalVisible()) { console.log('[CC Modal] already visible'); return; }
  if (modalOpening) { console.log('[CC Modal] opening in progress'); return; }
  modalOpening = true;
  console.log('[CC Modal] scheduleOpen', { enc });
  // Defer to next frame to avoid clashes with other handlers/reflows
  requestAnimationFrame(() => {
    try { openAssignModal(enc); } finally { modalOpening = false; }
  });
}

// Modal controls (look up on demand to avoid null refs after hot reloads)
function $id(id) { return document.getElementById(id); }

let modalCtx = { bank: 1, enc: 1 };

function showModal(show) {
  const modalBackdrop = $id('modal-backdrop');
  const modal = $id('cc-modal');
  const modalInput = $id('cc-input');
  if (!modalBackdrop || !modal) {
    console.warn('[CC Modal] Missing modal elements', { modalBackdrop: !!modalBackdrop, modal: !!modal });
    return;
  }
  if (show) {
    console.log('[CC Modal] show');
    modalBackdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => { try { modalInput && modalInput.focus(); modalInput && modalInput.select(); } catch {} }, 0);
  } else {
    console.log('[CC Modal] hide');
    modalBackdrop.classList.add('hidden');
    modal.classList.add('hidden');
  }
}

function openAssignModal(enc) {
  console.log('[CC Modal] openAssignModal', { enc });
  const s = latestState || {};
  const bank = (s && s.current_bank) || 1;
  modalCtx = { bank, enc };
  const modalBank = $id('cc-bank');
  const modalEnc = $id('cc-enc');
  const modalInput = $id('cc-input');
  const modalChan = $id('cc-channel');
  const modalLabel = $id('cc-label');
  if (!modalBank || !modalEnc || !modalInput || !modalLabel || !modalChan) {
    console.warn('[CC Modal] Missing fields', { modalBank: !!modalBank, modalEnc: !!modalEnc, modalInput: !!modalInput, modalLabel: !!modalLabel, modalChan: !!modalChan });
    return;
  }
  modalBank.textContent = String(bank);
  modalEnc.textContent = String(enc);
  const prev = (ccMap[bank] && ccMap[bank][enc] != null) ? ccMap[bank][enc] : '';
  modalInput.value = String(prev);
  const prevCh = (chanMap[bank] && chanMap[bank][enc] != null) ? chanMap[bank][enc] : 1;
  modalChan.value = String(prevCh);
  // Fill current label
  try {
    const currLabel = (latestState && latestState.banks && latestState.banks[bank] && latestState.banks[bank].encoders && latestState.banks[bank].encoders[enc] && latestState.banks[bank].encoders[enc].label) || '';
    modalLabel.value = currLabel;
  } catch {}
  showModal(true);
}

async function saveAssignModal() {
  const modalInput = $id('cc-input');
  const modalChan = $id('cc-channel');
  const modalLabel = $id('cc-label');
  if (!modalInput || !modalLabel || !modalChan) return;
  const cc = parseInt(modalInput.value, 10);
  if (!Number.isFinite(cc) || cc < 0 || cc > 127) { return; }
  const channel = Math.max(1, Math.min(16, parseInt(modalChan.value, 10) || 1));
  const label = String(modalLabel.value || '');
  try {
    // Stage mapping changes in memory only; do not persist until Save/Save As
    const res = await fetch('/api/mapping/temp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank: modalCtx.bank, encoder: modalCtx.enc, cc, channel, label }) });
    const out = await res.json();
    if (out && (out.mapping || out.channels)) {
      if (out.mapping) latestMapping = out.mapping;
      if (out.channels) chanMap = Object.fromEntries(Object.entries(out.channels).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, ch]) => [parseInt(e, 10), parseInt(ch, 10)]))]));
      // Mark dirty locally so Save enables immediately
      isDirty = true;
      if (dirtyFlagEl) dirtyFlagEl.classList.remove('hidden');
      if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = false;
      // Optimistically update label locally for snappy UI
      try {
        if (latestState && latestState.banks && latestState.banks[modalCtx.bank] && latestState.banks[modalCtx.bank].encoders && latestState.banks[modalCtx.bank].encoders[modalCtx.enc]) {
          latestState.banks[modalCtx.bank].encoders[modalCtx.enc].label = label;
        }
      } catch {}
      render(latestState || {}, latestMapping);
    }
  } catch {}
  showModal(false);
}

function cancelAssignModal() {
  showModal(false);
}

// WebSocket state with auto-reconnect
let ws = null;
let reconnectDelay = 500; // ms
const reconnectMax = 10000; // ms
let keepaliveId = null;

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function render(state, mapping = null, dirty = null) {
  latestState = state || latestState || {};
  if (mapping) latestMapping = mapping;
  if (dirty != null) {
    isDirty = !!dirty;
    if (dirtyFlagEl) {
      if (isDirty) dirtyFlagEl.classList.remove('hidden');
      else dirtyFlagEl.classList.add('hidden');
    }
    if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = !isDirty;
  }
  const bank = state.current_bank || 1;
  if (mapping) {
    // Normalize mapping: either {banks:{}} or flat {bank:{encoder:cc}}
    if (mapping.banks) {
      ccMap = Object.fromEntries(Object.entries(mapping.banks).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, cc]) => [parseInt(e, 10), parseInt(cc, 10)]))]));
    } else {
      ccMap = Object.fromEntries(Object.entries(mapping).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, cc]) => [parseInt(e, 10), parseInt(cc, 10)]))]));
    }
  }
  // Normalize channels map if provided on the state payload
  if (state && state.channels) {
    const chs = state.channels;
    chanMap = Object.fromEntries(Object.entries(chs).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, ch]) => [parseInt(e, 10), parseInt(ch, 10)]))]));
  }
  // Update active bank button
  bankButtons.forEach((btn) => {
    const b = parseInt(btn.dataset.bank, 10);
    if (b === bank) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  const bankState = (state.banks && state.banks[bank]) || { encoders: {} };
  const encoders = bankState.encoders || {};
  const keys = Array.from({ length: 16 }, (_, i) => i + 1);
  encodersEl.innerHTML = keys
    .map((k) => {
      const e = encoders[k] || { label: '', value: 0 };
      const pct = Math.round((e.value || 0) / 127 * 100);
      const cc = (ccMap[bank] && ccMap[bank][k] != null) ? ccMap[bank][k] : (k - 1);
      return `
        <div class="cell" data-enc="${k}" role="button" tabindex="0" aria-label="Encoder ${k} (CC ${cc})">
          <div class="label">${(e.label || ('Enc ' + k))}</div>
          <div class="bar">
            <div class="fill" style="width:${pct}%"></div>
            <div class="cc${showCC ? '' : ' hidden'}">CC ${cc}</div>
            <div class="value${showValue ? '' : ' hidden'}">${e.value || 0}</div>
          </div>
        </div>
      `;
    })
    .join('');
  // If learning, keep the armed encoder highlighted across renders
  if (midiLearn && learnTarget) {
    const armed = encodersEl.querySelector(`.cell[data-enc="${learnTarget.enc}"]`);
    if (armed) armed.classList.add('learning');
  }
}

async function fetchPorts() {
  try {
    const res = await fetch('/api/ports');
    const json = await res.json();
    const note = document.getElementById('ports-note');
    if (note) note.textContent = `Backend ports: inputs ${json.inputs.length}, outputs ${json.outputs.length}`;
  } catch (e) {
    const note = document.getElementById('ports-note');
    if (note) note.textContent = 'Failed to load backend ports';
  }
}

async function fetchPresets() {
  try {
    const res = await fetch('/api/presets');
    const js = await res.json();
    let presets = js.presets || [];
    presets = sortPresets(presets);
    const current = js.current || '';
    presetSelect.innerHTML = presets
      .map((n) => {
        const label = displayPresetName(n);
        return `<option value="${n}" ${n===current?'selected':''}>${label}</option>`;
      })
      .join('');
    currentPreset = current;
    updateActivePresetDisplay();
  } catch (e) {
    // ignore
  }
}

function displayPresetName(name) {
  const base = String(name || '').replace(/\.json$/i, '');
  return base.toLowerCase() === 'default' ? 'Default' : base;
}

function sortPresets(list) {
  const isDefault = (n) => String(n || '').toLowerCase() === 'default.json';
  const base = (n) => displayPresetName(n).toLowerCase();
  return [...list].sort((a, b) => {
    const aDef = isDefault(a);
    const bDef = isDefault(b);
    if (aDef && !bDef) return -1;
    if (!aDef && bDef) return 1;
    return base(a).localeCompare(base(b));
  });
}

function updateActivePresetDisplay(name = null) {
  if (!activePresetEl) return;
  const val = name != null ? name : currentPreset;
  const pretty = displayPresetName(val);
  if (pretty) {
    activePresetEl.textContent = `Preset: ${pretty}`;
    activePresetEl.classList.remove('hidden');
  } else {
    activePresetEl.textContent = '';
    activePresetEl.classList.add('hidden');
  }
  // Update live mode title (visible only in fullscreen via CSS)
  if (livePresetTitleEl) {
    livePresetTitleEl.textContent = pretty || '';
  }
}

function applyDisplaySettingsFromStorage() {
  try {
    const sCC = localStorage.getItem('fd.showCC');
    const sVal = localStorage.getItem('fd.showValue');
    if (sCC != null) showCC = sCC === '1';
    if (sVal != null) showValue = sVal === '1';
  } catch {}
  updateDisplayButtons();
}

function updateDisplayButtons() {
  if (showCCBtn) {
    showCCBtn.classList.toggle('active', !!showCC);
    showCCBtn.setAttribute('aria-pressed', showCC ? 'true' : 'false');
  }
  if (showValueBtn) {
    showValueBtn.classList.toggle('active', !!showValue);
    showValueBtn.setAttribute('aria-pressed', showValue ? 'true' : 'false');
  }
}

showCCBtn?.addEventListener('click', () => {
  showCC = !showCC;
  try { localStorage.setItem('fd.showCC', showCC ? '1' : '0'); } catch {}
  updateDisplayButtons();
  render(latestState || {}, latestMapping, isDirty);
});

showValueBtn?.addEventListener('click', () => {
  showValue = !showValue;
  try { localStorage.setItem('fd.showValue', showValue ? '1' : '0'); } catch {}
  updateDisplayButtons();
  render(latestState || {}, latestMapping, isDirty);
});

function applyThemeFromStorage() {
  try {
    const t = localStorage.getItem('fd.theme');
    themeMode = (t === 'light' || t === 'dark' || t === 'system') ? t : 'system';
  } catch { themeMode = 'system'; }
  applyTheme(themeMode);
}

function applyTheme(mode) {
  themeMode = mode;
  try { localStorage.setItem('fd.theme', mode); } catch {}
  const root = document.body;
  if (!root) return;
  if (mode === 'light') root.setAttribute('data-theme', 'light');
  else if (mode === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  updateThemeButtons();
  updateBrandingForTheme();
  setupSystemThemeListener();
}

function updateThemeButtons() {
  const set = (btn, on) => { if (!btn) return; btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  set(themeSystemBtn, themeMode === 'system');
  set(themeLightBtn, themeMode === 'light');
  set(themeDarkBtn, themeMode === 'dark');
}

themeSystemBtn?.addEventListener('click', () => applyTheme('system'));
themeLightBtn?.addEventListener('click', () => applyTheme('light'));
themeDarkBtn?.addEventListener('click', () => applyTheme('dark'));

function currentEffectiveTheme() {
  if (themeMode === 'light') return 'light';
  if (themeMode === 'dark') return 'dark';
  try {
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    return (mql && mql.matches) ? 'dark' : 'light';
  } catch { return 'light'; }
}

function updateBrandingForTheme() {
  const theme = currentEffectiveTheme();
  const logo = document.querySelector('img.logo');
  const icon = document.querySelector('link[rel="icon"]');
  const isDark = theme === 'dark';
  const logoPath = isDark ? '/logo-dark.png' : '/logo-light.png';
  if (logo && logo.getAttribute('src') !== logoPath) logo.setAttribute('src', logoPath);
  if (icon && icon.getAttribute('href') !== logoPath) icon.setAttribute('href', logoPath);
  const fsLogo = document.querySelector('.fs-brand img');
  if (fsLogo && fsLogo.getAttribute('src') !== logoPath) fsLogo.setAttribute('src', logoPath);
}

function setupSystemThemeListener() {
  // When in 'system' mode, watch for system scheme changes and update branding
  try {
    if (!prefersDarkMql && window.matchMedia) {
      prefersDarkMql = window.matchMedia('(prefers-color-scheme: dark)');
      prefersDarkMql.addEventListener?.('change', () => {
        if (themeMode === 'system') updateBrandingForTheme();
      });
    }
  } catch {}
}

function applyBankPosFromStorage() {
  try {
    const v = localStorage.getItem('fd.bankPos');
    bankPos = (v === 'below' || v === 'above') ? v : 'above';
  } catch { bankPos = 'above'; }
  applyBankPos(bankPos);
}

function applyBankPos(pos) {
  bankPos = pos === 'below' ? 'below' : 'above';
  try { localStorage.setItem('fd.bankPos', bankPos); } catch {}
  document.body.setAttribute('data-bank-pos', bankPos);
  updateBankPosButtons();
}

function updateBankPosButtons() {
  const set = (btn, on) => { if (!btn) return; btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false'); };
  set(bankPosAboveBtn, bankPos === 'above');
  set(bankPosBelowBtn, bankPos === 'below');
}

bankPosAboveBtn?.addEventListener('click', () => applyBankPos('above'));
bankPosBelowBtn?.addEventListener('click', () => applyBankPos('below'));

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  setStatus('Connecting…', 'connecting');
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = async () => {
    setStatus('Connected', 'connected');
    reconnectDelay = 500;
    // Prime UI with a fresh state fetch in case we missed updates
    try {
      const res = await fetch('/api/state');
      const js = await res.json();
      if (js && js.channels) {
        chanMap = Object.fromEntries(Object.entries(js.channels).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, ch]) => [parseInt(e, 10), parseInt(ch, 10)]))]));
      }
      render(js.state || js, js.mapping, js.dirty);
    } catch {}
    // Keepalive pings from browser side
    if (keepaliveId) clearInterval(keepaliveId);
    keepaliveId = setInterval(() => { try { ws && ws.send('ping'); } catch {} }, 15000);
  };
  ws.onclose = () => {
    setStatus(`Disconnected – retrying in ${Math.round(reconnectDelay/1000)}s`, 'disconnected');
    if (keepaliveId) { clearInterval(keepaliveId); keepaliveId = null; }
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectMax);
      connect();
    }, reconnectDelay);
  };
  ws.onerror = () => {
    setStatus('Connection error', 'error');
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.state) {
        if (msg.channels) {
          chanMap = Object.fromEntries(Object.entries(msg.channels).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, ch]) => [parseInt(e, 10), parseInt(ch, 10)]))]));
        }
        render(msg.state, msg.mapping, msg.dirty);
        // If a bank change was broadcast, echo bank-select to MIDI from this client
        if (msg.type === 'bank') {
          try {
            const b = (msg.state && msg.state.current_bank) || null;
            if (b && midiOut && (!sendBankToggle || sendBankToggle.checked)) {
              const control = (parseInt(b, 10) - 1) & 0x7f;
              midiOut.send([0xB0 | 3, control, 127]);
            }
          } catch {}
        }
      }
    } catch {}
  };
}

fetchPorts();
fetchPresets();
connect();
// Initialize Save button state
if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = true;
updateActivePresetDisplay();
applyDisplaySettingsFromStorage();
applyThemeFromStorage();
applyBankPosFromStorage();
applyThemeFromStorage();

// Helper to change bank from UI/keyboard
async function setBank(bank) {
  const b = parseInt(bank, 10);
  if (!(b >= 1 && b <= 4)) return;
  try {
    await fetch('/api/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank: b }) });
    // Also send bank select to the hardware via Web MIDI (channel 4 / control bank-1 / value 127)
    if (midiOut && (!sendBankToggle || sendBankToggle.checked)) {
      try {
        const control = b - 1;
        midiOut.send([0xB0 | 3, control & 0x7f, 127]);
      } catch {}
    }
  } catch {}
}

bankButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const bank = parseInt(btn.dataset.bank, 10);
    setBank(bank);
  });
});

// Toggle MIDI Devices panel visibility
settingsToggle?.addEventListener('click', () => {
  if (!midiSection || !settingsSection) return;
  // Toggle visibility based on MIDI section current state
  const hidden = midiSection.classList.toggle('hidden');
  // Keep Settings section in the same state as MIDI section
  settingsSection.classList.toggle('hidden', hidden);
  // Keep Display section in the same state as MIDI section
  if (displaySection) displaySection.classList.toggle('hidden', hidden);
  // Update toolbar button state + labels
  settingsToggle.classList.toggle('active', !hidden);
  const label = hidden ? 'Show Presets & MIDI' : 'Hide Presets & MIDI';
  settingsToggle.setAttribute('aria-label', label);
  settingsToggle.setAttribute('title', label);
  // Body classes drive layout ordering
  try {
    document.body.classList.toggle('show-midi', !hidden);
    document.body.classList.toggle('show-settings', !hidden);
  } catch {}
});

// Fullscreen toggle for Banks + Encoders only
async function enterFullscreen() {
  if (!liveView) return;
  try {
    await liveView.requestFullscreen?.();
  } catch {}
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
  } catch {}
}

function updateFullscreenButton() {
  const active = document.fullscreenElement === liveView;
  fullscreenToggle?.classList.toggle('active', active);
  fullscreenToggle?.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenToggle?.setAttribute('title', active ? 'Exit fullscreen' : 'Enter fullscreen');
}

fullscreenToggle?.addEventListener('click', () => {
  const active = document.fullscreenElement === liveView;
  if (active) exitFullscreen(); else enterFullscreen();
});

document.addEventListener('fullscreenchange', updateFullscreenButton);

function isLiveMode() {
  return document.fullscreenElement === liveView;
}

// (Settings panel is toggled via the gear button together with MIDI)

// Keyboard: 1-4 to select banks (when modal not visible and not typing in inputs)
window.addEventListener('keydown', (e) => {
  if (isModalVisible && isModalVisible()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (/(INPUT|TEXTAREA|SELECT)/.test(tag)) return;
  if (document.activeElement && document.activeElement.isContentEditable) return;
  if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
    e.preventDefault();
    setBank(parseInt(e.key, 10));
  }
});

// -------- Web MIDI Integration --------
function ccMessage(control, value, channel = 0) {
  // status byte for Control Change is 0xB0 | channel
  return [0xB0 | (channel & 0x0f), control & 0x7f, value & 0x7f];
}

async function postMidiToServer({ control, value, channel }) {
  try {
    await fetch('/api/midi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'control_change', control, value, channel })
    });
  } catch (e) {
    // ignore network errors; UI will still update via WS heartbeat when available
  }
}

function handleWebMidiMessage(e) {
  const [status, data1, data2] = e.data || [];
  if (status == null) return;
  const msgType = status & 0xf0;
  const channel = status & 0x0f; // 0..15
  if (msgType === 0xb0) {
    const control = data1 | 0;
    const value = data2 | 0;
    // Learn mode: capture next CC for the armed encoder
    if (midiLearn && learnTarget) {
      const { bank, enc } = learnTarget;
      console.log('[MIDI Learn] Captured CC', { bank, enc, control, channel, value });
      fetch('/api/mapping/temp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bank, encoder: enc, cc: control, channel: (channel + 1) })
      }).then((r) => r.json()).then((out) => {
        if (out && (out.mapping || out.channels)) {
          if (out.mapping) latestMapping = out.mapping;
          if (out.channels) chanMap = Object.fromEntries(Object.entries(out.channels).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, ch]) => [parseInt(e, 10), parseInt(ch, 10)]))]));
          isDirty = true;
          if (dirtyFlagEl) dirtyFlagEl.classList.remove('hidden');
          if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = false;
          document.querySelectorAll('.cell.learning').forEach((el) => el.classList.remove('learning'));
          learnTarget = null; // stay in learn mode for next assignment
          render(latestState || {}, latestMapping);
        }
      }).catch(() => {});
      return; // don't forward this CC
    }
    // Send to server to update shared state
    postMidiToServer({ control, value, channel });
    // Echo back to LEDs on Twister (optional)
    if (echoLED && midiOut) {
      try { midiOut.send(ccMessage(control, value, channel)); } catch {}
    }
  }
}

function chooseTwisterPort(ports) {
  const match = (name) => name && name.toLowerCase().includes('midi fighter twister');
  let chosen = null;
  for (const p of ports.values()) {
    if (match(p.name)) { chosen = p; break; }
  }
  return chosen || ports.values().next().value || null;
}

async function initWebMIDI() {
  if (!('requestMIDIAccess' in navigator)) {
    portsEl.textContent += '\n(Web MIDI unsupported in this browser)';
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    portsEl.textContent += '\n(Web MIDI permission denied)';
    return;
  }
  const populate = () => {
    // Build maps
    midiInMap = new Map(Array.from(midiAccess.inputs.values()).map(p => [p.id, p]));
    midiOutMap = new Map(Array.from(midiAccess.outputs.values()).map(p => [p.id, p]));
    // Populate selects
    const inOptions = Array.from(midiInMap.values()).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    const outOptions = Array.from(midiOutMap.values()).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (inSelect) inSelect.innerHTML = inOptions;
    if (outSelect) outSelect.innerHTML = outOptions;
    // Select defaults: previously saved, else prefer Twister, else first
    const savedIn = localStorage.getItem('fd.midi.in');
    const savedOut = localStorage.getItem('fd.midi.out');
    const findByName = (map, needle) => Array.from(map.values()).find(p => p.name && p.name.toLowerCase().includes(needle));
    const twIn = findByName(midiInMap, 'midi fighter twister');
    const twOut = findByName(midiOutMap, 'midi fighter twister');
    const inId = savedIn && midiInMap.has(savedIn) ? savedIn : (twIn && twIn.id) || (midiInMap.size && Array.from(midiInMap.keys())[0]);
    const outId = savedOut && midiOutMap.has(savedOut) ? savedOut : (twOut && twOut.id) || (midiOutMap.size && Array.from(midiOutMap.keys())[0]);
    if (inSelect && inId) inSelect.value = inId;
    if (outSelect && outId) outSelect.value = outId;
    // Apply selection
    midiIn = inId ? midiInMap.get(inId) : null;
    midiOut = outId ? midiOutMap.get(outId) : null;
    if (midiIn) {
      try { midiIn.onmidimessage = handleWebMidiMessage; } catch {}
    }
  };

  populate();
  try { midiAccess.onstatechange = () => populate(); } catch {}
}

// Request Web MIDI after a short delay to allow page to settle
setTimeout(initWebMIDI, 200);

// ----- Simple CC assignment via clicking label or MIDI learn -----
encodersEl.addEventListener('click', (ev) => {
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  const enc = parseInt(cell.dataset.enc, 10);
  if (!enc) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (midiLearn) {
    // Arm this encoder for learning
    learnTarget = { bank: (latestState && latestState.current_bank) || 1, enc };
    document.querySelectorAll('.cell.learning').forEach((el) => el.classList.remove('learning'));
    cell.classList.add('learning');
    console.log('[MIDI Learn] Armed', learnTarget);
    return;
  }
  if (isLiveMode()) return; // ignore modal opens in live fullscreen mode
  console.log('[CC Modal] cell click', { enc });
  scheduleOpen(enc);
});

// Keyboard support on label (Enter/Space)
encodersEl.addEventListener('keydown', (ev) => {
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  if (midiLearn) return; // don't open modal while learning
  if (!isLiveMode() && (ev.key === 'Enter' || ev.key === ' ')) {
    ev.preventDefault();
    const enc = parseInt(cell.dataset.enc, 10);
    if (enc) {
      console.log('[CC Modal] cell keydown', { enc, key: ev.key });
      scheduleOpen(enc);
    }
  }
});

// Fallback: pointerup to catch some platforms where click is flaky
encodersEl.addEventListener('pointerup', (ev) => {
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  const enc = parseInt(cell.dataset.enc, 10);
  if (!enc) return;
  if (midiLearn) return; // don't open modal while learning
  if (!isModalVisible() && !isLiveMode()) {
    console.log('[CC Modal] cell pointerup', { enc });
    scheduleOpen(enc);
  }
});

// Arm on pointerdown as well, to be more responsive
encodersEl.addEventListener('pointerdown', (ev) => {
  if (!midiLearn) return;
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  const enc = parseInt(cell.dataset.enc, 10);
  if (!enc) return;
  ev.preventDefault();
  ev.stopPropagation();
  learnTarget = { bank: (latestState && latestState.current_bank) || 1, enc };
  document.querySelectorAll('.cell.learning').forEach((el) => el.classList.remove('learning'));
  cell.classList.add('learning');
  console.log('[MIDI Learn] Armed (pointerdown)', learnTarget);
});

document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && target.id === 'cc-cancel') { e.preventDefault(); cancelAssignModal(); }
  if (target && target.id === 'cc-save') { e.preventDefault(); saveAssignModal(); }
  if (target && target.id === 'modal-backdrop') { e.preventDefault(); cancelAssignModal(); }
});

window.addEventListener('keydown', (e) => {
  const modal = $id('cc-modal');
  if (modal && !modal.classList.contains('hidden')) {
    if (e.key === 'Escape') { e.preventDefault(); cancelAssignModal(); }
    if (e.key === 'Enter') { e.preventDefault(); saveAssignModal(); }
  }
});

// Temporary test button
// Removed test modal button

// Presets UI
// Change of selection no longer auto-loads; loading is on-demand via the Load button
presetSelect?.addEventListener('change', () => {
  // No-op: user must click Load to apply the selected preset
});

function confirmDiscardIfDirty(selectedName) {
  if (!isDirty) return true;
  if (selectedName && selectedName === currentPreset) return true;
  return confirm('You have unsaved changes. Load preset and discard changes?');
}

presetLoadBtn?.addEventListener('click', async () => {
  if (!presetSelect) return;
  const name = presetSelect.value;
  if (!name) return;
  if (!confirmDiscardIfDirty(name)) return;
  try {
    const r = await fetch('/api/presets/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const js = await r.json();
    if (js && js.ok) {
      await fetchPresets();
      // Reset dirty UI; server will also reflect via ws/state
      isDirty = false;
      if (dirtyFlagEl) dirtyFlagEl.classList.add('hidden');
      if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = true;
      updateActivePresetDisplay(name);
    }
  } catch {}
});

// MIDI selects and refresh
inSelect?.addEventListener('change', () => {
  const id = inSelect.value;
  const port = midiInMap.get(id) || null;
  if (port) {
    try { port.onmidimessage = handleWebMidiMessage; } catch {}
  }
  midiIn = port;
  localStorage.setItem('fd.midi.in', id || '');
});

outSelect?.addEventListener('change', () => {
  const id = outSelect.value;
  midiOut = midiOutMap.get(id) || null;
  localStorage.setItem('fd.midi.out', id || '');
});

midiRefreshBtn?.addEventListener('click', () => {
  try { initWebMIDI(); } catch {}
});

// Toggle: send bank changes to device
sendBankToggle?.addEventListener('change', () => {
  localStorage.setItem('fd.sendBank', sendBankToggle.checked ? '1' : '0');
});
if (sendBankToggle) {
  const saved = localStorage.getItem('fd.sendBank');
  if (saved) sendBankToggle.checked = saved === '1';
}

// MIDI Learn toggle
midiLearnBtn?.addEventListener('click', () => {
  midiLearn = !midiLearn;
  if (midiLearnBtn) midiLearnBtn.classList.toggle('active', midiLearn);
  console.log('[MIDI Learn] toggled', midiLearn);
  const ln = document.getElementById('learn-note');
  if (ln) ln.classList.toggle('hidden', !midiLearn);
  if (!midiLearn) {
    learnTarget = null;
    document.querySelectorAll('.cell.learning').forEach((el) => el.classList.remove('learning'));
  }
});

presetSaveBtn?.addEventListener('click', async () => {
  const name = prompt('Save preset as (name):');
  if (!name) return;
  try {
    const r = await fetch('/api/presets/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const js = await r.json();
    if (js && js.ok) {
      await fetchPresets();
      // Select the saved preset
      if (js.preset) presetSelect.value = js.preset;
      isDirty = false;
      if (dirtyFlagEl) dirtyFlagEl.classList.add('hidden');
      if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = true;
      updateActivePresetDisplay(js.preset || null);
    }
  } catch {}
});

presetSaveCurrentBtn?.addEventListener('click', async () => {
  try {
    const r = await fetch('/api/presets/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const js = await r.json();
    if (js && js.ok) {
      await fetchPresets();
      if (js.preset) presetSelect.value = js.preset;
      isDirty = false;
      if (dirtyFlagEl) dirtyFlagEl.classList.add('hidden');
      if (presetSaveCurrentBtn) presetSaveCurrentBtn.disabled = true;
      updateActivePresetDisplay(js.preset || null);
    }
  } catch {}
});

// Download selected (or current) preset file
presetDownloadBtn?.addEventListener('click', () => {
  const name = (presetSelect && presetSelect.value) || currentPreset || '';
  if (!name) return;
  const url = `/api/presets/download?name=${encodeURIComponent(name)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

// Warn on page unload if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});
