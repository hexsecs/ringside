const statusEl = document.getElementById('status');
const encodersEl = document.getElementById('encoders');
const portsEl = document.getElementById('ports');
const bankButtons = Array.from(document.querySelectorAll('.bank button'));

function render(state) {
  const bank = state.current_bank || 1;
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
      return `
        <div class="cell">
          <div class="label">${e.label || 'Enc ' + k}</div>
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
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => (statusEl.textContent = 'Connected');
  ws.onclose = () => (statusEl.textContent = 'Disconnected');
  ws.onerror = () => (statusEl.textContent = 'Error');
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.state) {
        render(msg.state);
      }
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
