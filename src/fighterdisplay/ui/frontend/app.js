const statusEl = document.getElementById('status');
const encodersEl = document.getElementById('encoders');
const portsEl = document.getElementById('ports');
const bankButtons = Array.from(document.querySelectorAll('.bank button'));
const presetSelect = document.getElementById('preset-select');
const presetSaveBtn = document.getElementById('preset-save');

// Web MIDI state
let midiAccess = null;
let midiIn = null;
let midiOut = null;
let echoLED = true; // echo CC back to Twister to drive LED rings
let ccMap = {}; // { bank: { encoder: cc } }

// Cache last known state/mapping for quick local reads
let latestState = null;
let latestMapping = null;
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
  const modalLabel = $id('cc-label');
  if (!modalBank || !modalEnc || !modalInput || !modalLabel) {
    console.warn('[CC Modal] Missing fields', { modalBank: !!modalBank, modalEnc: !!modalEnc, modalInput: !!modalInput, modalLabel: !!modalLabel });
    return;
  }
  modalBank.textContent = String(bank);
  modalEnc.textContent = String(enc);
  const prev = (ccMap[bank] && ccMap[bank][enc] != null) ? ccMap[bank][enc] : '';
  modalInput.value = String(prev);
  // Fill current label
  try {
    const currLabel = (latestState && latestState.banks && latestState.banks[bank] && latestState.banks[bank].encoders && latestState.banks[bank].encoders[enc] && latestState.banks[bank].encoders[enc].label) || '';
    modalLabel.value = currLabel;
  } catch {}
  showModal(true);
}

async function saveAssignModal() {
  const modalInput = $id('cc-input');
  const modalLabel = $id('cc-label');
  if (!modalInput || !modalLabel) return;
  const cc = parseInt(modalInput.value, 10);
  if (!Number.isFinite(cc) || cc < 0 || cc > 127) { return; }
  const label = String(modalLabel.value || '');
  try {
    const res = await fetch('/api/mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank: modalCtx.bank, encoder: modalCtx.enc, cc, label }) });
    const out = await res.json();
    if (out && out.mapping) {
      latestMapping = out.mapping;
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

function render(state, mapping = null) {
  latestState = state || latestState || {};
  if (mapping) latestMapping = mapping;
  const bank = state.current_bank || 1;
  if (mapping) {
    // Normalize mapping: either {banks:{}} or flat {bank:{encoder:cc}}
    if (mapping.banks) {
      ccMap = Object.fromEntries(Object.entries(mapping.banks).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, cc]) => [parseInt(e, 10), parseInt(cc, 10)]))]));
    } else {
      ccMap = Object.fromEntries(Object.entries(mapping).map(([b, encs]) => [parseInt(b, 10), Object.fromEntries(Object.entries(encs).map(([e, cc]) => [parseInt(e, 10), parseInt(cc, 10)]))]));
    }
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
          <div class="label">${(e.label || ('Enc ' + k)) + ' (CC ' + cc + ')'}</div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          <div class="value">${e.value || 0}</div>
        </div>
      `;
    })
    .join('');
}

async function fetchPorts() {
  try {
    const res = await fetch('/api/ports');
    const json = await res.json();
    portsEl.textContent = JSON.stringify(json, null, 2);
  } catch (e) {
    portsEl.textContent = 'Failed to load ports';
  }
}

async function fetchPresets() {
  try {
    const res = await fetch('/api/presets');
    const js = await res.json();
    const presets = js.presets || [];
    const current = js.current || '';
    presetSelect.innerHTML = presets.map((n) => `<option value="${n}" ${n===current?'selected':''}>${n}</option>`).join('');
  } catch (e) {
    // ignore
  }
}

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
      render(js.state || js, js.mapping);
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
      if (msg.state) render(msg.state, msg.mapping);
    } catch {}
  };
}

fetchPorts();
fetchPresets();
connect();

bankButtons.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const bank = parseInt(btn.dataset.bank, 10);
    try {
      await fetch('/api/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank }) });
    } catch {}
  });
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
  // Pick ports (prefer Twister)
  midiIn = chooseTwisterPort(midiAccess.inputs);
  midiOut = chooseTwisterPort(midiAccess.outputs);
  if (midiIn) {
    try { midiIn.onmidimessage = handleWebMidiMessage; } catch {}
  }
  // Show Web MIDI ports alongside backend ports
  try {
    const ins = Array.from(midiAccess.inputs.values()).map(p => p.name);
    const outs = Array.from(midiAccess.outputs.values()).map(p => p.name);
    const current = portsEl.textContent || '';
    const web = { webmidi: { inputs: ins, outputs: outs, selected: { input: midiIn && midiIn.name, output: midiOut && midiOut.name } } };
    portsEl.textContent = (current ? current + '\n' : '') + JSON.stringify(web, null, 2);
  } catch {}
}

// Request Web MIDI after a short delay to allow page to settle
setTimeout(initWebMIDI, 200);

// ----- Simple CC assignment via clicking label -----
encodersEl.addEventListener('click', (ev) => {
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  const enc = parseInt(cell.dataset.enc, 10);
  if (!enc) return;
  console.log('[CC Modal] cell click', { enc });
  scheduleOpen(enc);
});

// Keyboard support on label (Enter/Space)
encodersEl.addEventListener('keydown', (ev) => {
  const cell = ev.target.closest('.cell[data-enc]');
  if (!cell) return;
  if (ev.key === 'Enter' || ev.key === ' ') {
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
  if (!isModalVisible()) {
    console.log('[CC Modal] cell pointerup', { enc });
    scheduleOpen(enc);
  }
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
document.getElementById('test-open-modal')?.addEventListener('click', (e) => {
  e.preventDefault();
  console.log('[CC Modal] test button clicked');
  openAssignModal(1);
});

// Presets UI
presetSelect?.addEventListener('change', async () => {
  const name = presetSelect.value;
  try {
    const r = await fetch('/api/presets/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const js = await r.json();
    if (js && js.ok) {
      // Refresh presets in case current changed
      fetchPresets();
    }
  } catch {}
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
    }
  } catch {}
});
