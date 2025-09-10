const statusEl = document.getElementById('status');
const encodersEl = document.getElementById('encoders');
const portsEl = document.getElementById('ports');
const bankButtons = Array.from(document.querySelectorAll('.bank button'));

// Web MIDI state
let midiAccess = null;
let midiIn = null;
let midiOut = null;
let echoLED = true; // echo CC back to Twister to drive LED rings
let ccMap = {}; // { bank: { encoder: cc } }

// Cache last known state/mapping for quick local reads
let latestState = null;
let latestMapping = null;

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
        <div class="cell">
          <div class="label" data-enc="${k}">${(e.label || ('Enc ' + k)) + ' (CC ' + cc + ')'}</div>
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
encodersEl.addEventListener('click', async (ev) => {
  const label = ev.target.closest('.label');
  if (!label) return;
  ev.preventDefault();
  ev.stopPropagation();
  const enc = parseInt(label.dataset.enc, 10);
  if (!enc) return;
  // Use cached state to avoid extra network calls and potential stalls
  const s = latestState || {};
  const bank = (s && s.current_bank) || 1;
  const prev = (ccMap[bank] && ccMap[bank][enc] != null) ? ccMap[bank][enc] : '';
  // Prompt can be cancelled; handle gracefully and do nothing
  const ccStr = window.prompt(`Assign CC for Bank ${bank} Enc ${enc}`, String(prev));
  if (ccStr == null) return;
  // Accept only integers 0..127
  const cc = parseInt(ccStr, 10);
  if (!Number.isFinite(cc) || cc < 0 || cc > 127) return;
  try {
    const res = await fetch('/api/mapping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank, encoder: enc, cc }) });
    const out = await res.json();
    if (out && out.mapping) {
      latestMapping = out.mapping;
      render(latestState || {}, latestMapping);
    }
  } catch {}
});
