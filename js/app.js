// js/app.js
import { requireAuth, logout } from './auth.js';
import { connect, disconnect, isConnected, isSupported } from './bluetooth.js';
import {
  getPatients, addPatient, deletePatient, updatePatient,
  saveReading, getAllReadings, getLatestReading,
  getAlerts, createAlert, clearAlerts
} from './db.js';

// ─── State ────────────────────────────────────────────────────
let patients = [];
let alerts = [];
let currentReading = { heart_rate: null, spo2: null, temperature: null, fall_detected: false };
let selectedPatientId = null;
let activeFilter = 'todos';
let realtimeSearchQuery = '';

// ─── Thresholds ───────────────────────────────────────────────
let THRESHOLDS = {
  hr_high: 100, hr_low: 50,
  spo2_warn: 94, spo2_alert: 90,
  temp_warn: 37.5, temp_alert: 38.5,
};
function loadThresholds() {
  const s = localStorage.getItem('vg_thresholds');
  if (s) THRESHOLDS = { ...THRESHOLDS, ...JSON.parse(s) };
}
function saveThresholds() {
  localStorage.setItem('vg_thresholds', JSON.stringify(THRESHOLDS));
}

// ─── Dark theme ───────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('vg_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved === 'dark' || (!saved && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  updateThemeIcon(dark);
}
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('vg_theme', next);
  updateThemeIcon(!isDark);
  const darkToggle = document.getElementById('dark-toggle');
  if (darkToggle) darkToggle.checked = !isDark;
}
function updateThemeIcon(isDark) {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.title = isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  btn.innerHTML = isDark
    ? `<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.22 3.22l1.06 1.06M11.72 11.72l1.06 1.06M3.22 12.78l1.06-1.06M11.72 4.28l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 16 16" fill="none"><path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadThresholds();

  const user = await requireAuth();
  if (!user) return;

  document.getElementById('user-email').textContent = user.email;
  document.getElementById('settings-email').textContent = user.email;

  await loadPatients();
  await loadAlerts();
  renderHome();
  renderRegistos();
  refreshPatientSelector();

  // Navigation
  document.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.screen));
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // BLE
  document.getElementById('ble-btn').addEventListener('click', toggleBluetooth);
  document.getElementById('patient-selector').addEventListener('change', (e) => {
    selectedPatientId = e.target.value || null;
    applyRealtimeFilter();
  });

  // Search + filter chips
  document.getElementById('tr-search').addEventListener('input', (e) => {
    realtimeSearchQuery = e.target.value.toLowerCase();
    applyRealtimeFilter();
  });
  document.querySelectorAll('[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => setFilter(chip));
  });

  // Add patient form
  document.getElementById('add-form').addEventListener('submit', handleAddPatient);
  document.getElementById('clear-btn').addEventListener('click', clearForm);

  // Bell
  document.getElementById('bell-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notif-panel').classList.toggle('show');
  });
  document.getElementById('notif-clear').addEventListener('click', handleClearAlerts);
  document.addEventListener('click', () => document.getElementById('notif-panel').classList.remove('show'));

  // Logout
  document.querySelectorAll('.logout-trigger').forEach(b => b.addEventListener('click', logout));

  // Export
  document.getElementById('export-btn').addEventListener('click', exportCSV);

  // Settings
  initSettings();
});

// ─── Navigation ───────────────────────────────────────────────
const screenMeta = {
  home:       { title: 'Painel de controlo', live: false },
  realtime:   { title: 'Tempo real',         live: true  },
  registos:   { title: 'Registos',           live: false },
  adicionar:  { title: 'Adicionar utente',   live: false },
  definicoes: { title: 'Definições',         live: false },
};

export function goTo(name) {
  document.querySelectorAll('[data-screen]').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === name)
  );
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === 'screen-' + name)
  );
  const meta = screenMeta[name] || { title: name, live: false };
  document.getElementById('topbar-title').textContent = meta.title;
  document.getElementById('live-badge').style.display = meta.live ? 'inline-flex' : 'none';

  if (name === 'realtime')   renderRealtimeTable();
  if (name === 'registos')   renderRegistos();
  if (name === 'home')       renderHome();
}

// ─── Data loaders ─────────────────────────────────────────────
async function loadPatients() {
  try { patients = await getPatients(); }
  catch (e) { showToast('Erro ao carregar utentes.', 'error'); }
}

async function loadAlerts() {
  try { alerts = await getAlerts(); renderAlerts(); }
  catch (e) { console.error(e); }
}

// ─── Home ─────────────────────────────────────────────────────
async function renderHome() {
  let normal = 0, atencao = 0, alertCount = 0;
  for (const p of patients) {
    const r = await getLatestReading(p.id);
    const s = getStatus(r);
    if (s === 'normal') normal++;
    else if (s === 'atencao') atencao++;
    else if (s === 'alerta') alertCount++;
  }
  document.getElementById('stat-total').textContent = patients.length;
  document.getElementById('stat-normal').textContent = normal;
  document.getElementById('stat-atencao').textContent = atencao;
  document.getElementById('stat-alerta').textContent = alertCount;

  const list = document.getElementById('recent-patients');
  list.innerHTML = '';
  for (const p of patients.slice(0, 6)) {
    const r = await getLatestReading(p.id);
    const s = getStatus(r);
    const colors = avatarColors(p.id);
    list.innerHTML += `
      <div class="patient-row" onclick="goTo('realtime')">
        <div class="avatar" style="background:${colors.bg};color:${colors.fg}">${getInitials(p.name)}</div>
        <div>
          <div class="p-name">${p.name}</div>
          <div class="p-sub">${formatReading(r)}</div>
        </div>
        <span class="badge badge-${s === 'normal' ? 'ok' : s === 'atencao' ? 'warn' : 'alert'}">
          ${s === 'normal' ? 'Normal' : s === 'atencao' ? 'Atenção' : 'Alerta'}
        </span>
      </div>`;
  }
  if (!patients.length) list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:16px 0">Sem utentes registados.</div>';
}

// ─── Alerts ───────────────────────────────────────────────────
function renderAlerts() {
  const panel = document.getElementById('notif-list');
  const badge = document.getElementById('bell-badge');
  const header = document.getElementById('notif-count');

  if (!alerts.length) {
    panel.innerHTML = '<div class="notif-empty">Sem alertas recentes.</div>';
    badge.style.display = 'none';
    header.textContent = 'Notificações';
    document.getElementById('home-alerts').innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:8px 0">Sem alertas.</div>';
    return;
  }

  badge.style.display = 'block';
  header.textContent = `Notificações (${alerts.length})`;
  const homeAlerts = document.getElementById('home-alerts');
  homeAlerts.innerHTML = '';
  panel.innerHTML = '';

  alerts.slice(0, 5).forEach(a => {
    const isAlert = a.type === 'alert';
    const time = new Date(a.created_at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    homeAlerts.innerHTML += `
      <div class="alert-item">
        <div class="alert-dot ${isAlert ? 'dot-alert' : 'dot-warn'}"></div>
        <div><div class="alert-txt">${a.patients?.name || 'Utente'} — ${a.message}</div></div>
        <div class="alert-time">${time}</div>
      </div>`;
    panel.innerHTML += `
      <div class="notif-item">
        <div class="alert-dot ${isAlert ? 'dot-alert' : 'dot-warn'}" style="margin-top:4px"></div>
        <div>
          <div class="notif-txt">${a.patients?.name || 'Utente'} — ${a.message}</div>
          <div class="notif-sub">${time}</div>
        </div>
      </div>`;
  });
}

async function handleClearAlerts() {
  try { await clearAlerts(); alerts = []; renderAlerts(); showToast('Alertas limpos.'); }
  catch (e) { showToast('Erro ao limpar alertas.', 'error'); }
}

// ─── Realtime ─────────────────────────────────────────────────
async function renderRealtimeTable() {
  const tbody = document.getElementById('rt-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><div class="loading"><div class="spinner"></div>A carregar...</div></td></tr>';

  const rows = [];
  for (const p of patients) {
    const r = await getLatestReading(p.id);
    rows.push({ patient: p, reading: r });
  }

  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Sem utentes registados.</td></tr>';
    return;
  }

  rows.forEach(({ patient, reading }) => {
    const status = getStatus(reading);
    const colors = avatarColors(patient.id);
    const isSelected = selectedPatientId && patient.id === selectedPatientId;

    const tr = document.createElement('tr');
    tr.dataset.status = status;
    tr.dataset.name = patient.name.toLowerCase();
    tr.dataset.pid = patient.id;

    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:30px;height:30px;font-size:10px;background:${colors.bg};color:${colors.fg}">${getInitials(patient.name)}</div>
          <div>
            <div style="font-weight:500">${patient.name}</div>
            ${isSelected ? '<div style="font-size:11px;color:var(--teal-400)">● Dispositivo ligado</div>' : ''}
          </div>
        </div>
      </td>
      <td data-label="FC">${reading?.heart_rate != null ? reading.heart_rate + ' bpm' : '—'}</td>
      <td data-label="SpO₂">${reading?.spo2 != null ? reading.spo2 + '%' : '—'}</td>
      <td data-label="Temp">${reading?.temperature != null ? reading.temperature + ' °C' : '—'}</td>
      <td data-label="Queda">${reading?.fall_detected ? '<span style="color:#E24B4A;font-weight:500">⚠ Queda</span>' : '—'}</td>
      <td data-label="Estado"><span class="vp vp-${status === 'normal' ? 'ok' : status === 'atencao' ? 'warn' : status === 'alerta' ? 'alert' : 'none'}">
        ${status === 'normal' ? 'Normal' : status === 'atencao' ? 'Atenção' : status === 'alerta' ? 'Alerta' : 'Sem dados'}
      </span></td>
      <td data-label="Ações">
        <button class="action-btn danger" onclick="handleDeletePatient('${patient.id}', '${patient.name.replace(/'/g, "\\'")}')">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Apagar
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  applyRealtimeFilter();
}

// ─── Filter: show ONLY matching rows, hide everything else ────
function applyRealtimeFilter() {
  const rows = document.querySelectorAll('#rt-tbody tr[data-pid]');

  rows.forEach(row => {
    const matchesStatus = activeFilter === 'todos' || row.dataset.status === activeFilter;
    const matchesSearch = !realtimeSearchQuery || row.dataset.name.includes(realtimeSearchQuery);
    // If a specific patient is selected in the BLE dropdown, show only that patient
    const matchesSelected = !selectedPatientId || row.dataset.pid === selectedPatientId;

    const visible = matchesStatus && matchesSearch && matchesSelected;
    row.style.display = visible ? '' : 'none';
  });
}

function setFilter(el) {
  document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  activeFilter = el.dataset.filter;
  applyRealtimeFilter();
}

// ─── Delete patient ───────────────────────────────────────────
window.handleDeletePatient = async (id, name) => {
  if (!confirm(`Apagar "${name}"? Esta acção remove todos os dados do utente e não pode ser desfeita.`)) return;
  try {
    await deletePatient(id);
    await loadPatients();
    refreshPatientSelector();
    if (selectedPatientId === id) selectedPatientId = null;
    renderRealtimeTable();
    renderRegistos();
    renderHome();
    showToast(`"${name}" apagado.`, 'success');
  } catch (e) {
    showToast('Erro ao apagar utente.', 'error');
  }
};

// ─── Vital cards ──────────────────────────────────────────────
function updateVitalCards(reading) {
  setVital('hr',   reading.heart_rate,  v => v > THRESHOLDS.hr_high || v < THRESHOLDS.hr_low ? 'alert' : v > THRESHOLDS.hr_high - 10 ? 'warn' : 'ok');
  setVital('spo2', reading.spo2,        v => v < THRESHOLDS.spo2_alert ? 'alert' : v < THRESHOLDS.spo2_warn ? 'warn' : 'ok');
  setVital('temp', reading.temperature, v => v > THRESHOLDS.temp_alert ? 'alert' : v > THRESHOLDS.temp_warn ? 'warn' : 'ok');

  const fallCard = document.getElementById('vital-fall');
  if (reading.fall_detected) {
    fallCard.className = 'vital-card alert';
    fallCard.querySelector('.vital-value').textContent = 'Queda!';
    fallCard.querySelector('.vital-status').className = 'vital-status vp vp-alert';
    fallCard.querySelector('.vital-status').textContent = 'Alerta';
  } else {
    fallCard.className = 'vital-card ok';
    fallCard.querySelector('.vital-value').textContent = 'OK';
    fallCard.querySelector('.vital-status').className = 'vital-status vp vp-ok';
    fallCard.querySelector('.vital-status').textContent = 'Normal';
  }
}

function setVital(key, value, statusFn) {
  const card = document.getElementById('vital-' + key);
  const valEl = card.querySelector('.vital-value');
  const statusEl = card.querySelector('.vital-status');
  if (value == null) {
    card.className = 'vital-card off';
    valEl.textContent = '—';
    statusEl.textContent = 'Sem dados';
    statusEl.className = 'vital-status vp vp-none';
    return;
  }
  const s = statusFn(value);
  card.className = 'vital-card ' + s;
  valEl.textContent = value;
  statusEl.textContent = s === 'ok' ? 'Normal' : s === 'warn' ? 'Atenção' : 'Alerta';
  statusEl.className = `vital-status vp vp-${s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : 'alert'}`;
}

// ─── Bluetooth ────────────────────────────────────────────────
async function toggleBluetooth() {
  const btn = document.getElementById('ble-btn');
  const label = document.getElementById('ble-label');
  const selector = document.getElementById('patient-selector');

  if (isConnected()) {
    await disconnect();
    btn.classList.remove('connected');
    label.textContent = 'Ligar dispositivo ESP32';
    selectedPatientId = null;
    selector.value = '';
    showToast('Dispositivo desligado.');
    applyRealtimeFilter();
    return;
  }

  if (!isSupported()) { showToast('Web Bluetooth não suportado. Use o Chrome.', 'error'); return; }
  if (!selectedPatientId) {
    showToast('Seleccione um utente primeiro.', 'error');
    selector.style.border = '1.5px solid #E24B4A';
    setTimeout(() => selector.style.border = '', 2000);
    return;
  }

  btn.disabled = true;
  label.textContent = 'A ligar...';
  try {
    const name = await connect(onBLEData, onBLEDisconnect);
    btn.classList.add('connected');
    label.textContent = 'Desligar — ' + name;
    showToast('Ligado a ' + name + '!', 'success');
    applyRealtimeFilter();
  } catch (e) {
    label.textContent = 'Ligar dispositivo ESP32';
    if (e.name !== 'NotFoundError') showToast('Erro: ' + e.message, 'error');
  } finally { btn.disabled = false; }
}

async function onBLEData(data) {
  currentReading = { ...currentReading, ...data };
  updateVitalCards(currentReading);
  if (currentReading.heart_rate != null && currentReading.spo2 != null && currentReading.temperature != null) {
    try {
      await saveReading(selectedPatientId, currentReading);
      await checkThresholds(currentReading);
      if (document.getElementById('screen-realtime').classList.contains('active')) renderRealtimeTable();
    } catch (e) { console.error('Erro ao guardar leitura:', e); }
  }
}

function onBLEDisconnect() {
  document.getElementById('ble-btn').classList.remove('connected');
  document.getElementById('ble-label').textContent = 'Ligar dispositivo ESP32';
  showToast('Dispositivo desligado.', 'error');
}

async function checkThresholds(r) {
  if (!selectedPatientId) return;
  const checks = [
    [r.fall_detected,                                                           'alert', 'Queda detectada'],
    [r.heart_rate > THRESHOLDS.hr_high || r.heart_rate < THRESHOLDS.hr_low,    'warn',  `FC fora do normal: ${r.heart_rate} bpm`],
    [r.spo2 < THRESHOLDS.spo2_alert,                                            'alert', `SpO₂ crítico: ${r.spo2}%`],
    [r.spo2 < THRESHOLDS.spo2_warn && r.spo2 >= THRESHOLDS.spo2_alert,         'warn',  `SpO₂ baixo: ${r.spo2}%`],
    [r.temperature > THRESHOLDS.temp_alert,                                     'alert', `Febre alta: ${r.temperature}°C`],
    [r.temperature > THRESHOLDS.temp_warn && r.temperature <= THRESHOLDS.temp_alert, 'warn', `Temperatura elevada: ${r.temperature}°C`],
  ];
  for (const [cond, type, msg] of checks) {
    if (cond) { await createAlert(selectedPatientId, type, msg); await loadAlerts(); }
  }
}

// ─── Add patient ──────────────────────────────────────────────
async function handleAddPatient(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'A adicionar...';

  const patient = {
    name:       document.getElementById('f-nome').value.trim(),
    institution_id: document.getElementById('f-inst').value.trim(),
    phone:      document.getElementById('f-tel').value.trim(),
    email:      document.getElementById('f-email').value.trim(),
    address:    [document.getElementById('f-morada').value.trim(), document.getElementById('f-loc').value.trim(), document.getElementById('f-cp').value.trim()].filter(Boolean).join(', '),
    nif:        document.getElementById('f-nif').value.trim(),
    nhc:        document.getElementById('f-utente').value.trim(),
    dob:        document.getElementById('f-dob').value || null,
    height_cm:  document.getElementById('f-altura').value ? parseFloat(document.getElementById('f-altura').value) : null,
    weight_kg:  document.getElementById('f-peso').value ? parseFloat(document.getElementById('f-peso').value) : null,
    health_history: document.getElementById('f-historico').value.trim(),
    notes:      document.getElementById('f-notas').value.trim(),
  };

  try {
    await addPatient(patient);
    await loadPatients();
    refreshPatientSelector();
    clearForm();
    showToast(`Utente "${patient.name}" adicionado!`, 'success');
    setTimeout(() => goTo('home'), 1000);
  } catch (e) {
    showToast('Erro ao adicionar utente: ' + e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Adicionar utente';
  }
}

function clearForm() { document.getElementById('add-form').reset(); }

function refreshPatientSelector() {
  const sel = document.getElementById('patient-selector');
  const current = sel.value;
  sel.innerHTML = '<option value="">Seleccionar utente...</option>';
  patients.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    if (p.id === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ─── Registos ─────────────────────────────────────────────────
async function renderRegistos() {
  const tbody = document.getElementById('reg-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="8"><div class="loading"><div class="spinner"></div>A carregar...</div></td></tr>';

  try {
    await loadPatients();
    const readings = await getAllReadings(200);

    // Group readings by patient
    const byPatient = {};
    readings.forEach(r => {
      if (!byPatient[r.patient_id]) byPatient[r.patient_id] = [];
      byPatient[r.patient_id].push(r);
    });

    tbody.innerHTML = '';

    if (!patients.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Sem utentes registados.</td></tr>';
      return;
    }

    const withReadings = patients.filter(p => byPatient[p.id]?.length);
    const without = patients.filter(p => !byPatient[p.id]?.length);

    const renderRows = (p) => {
      const colors = avatarColors(p.id);
      const pReadings = byPatient[p.id] || [];

      // notes: prefer from patient record directly (fixes old patients)
      // also check first reading's joined patient data as fallback
      const notes = p.notes || pReadings[0]?.patients?.notes || '';

      const nameCell = (showNotes) => {
        const age = p.dob ? Math.floor((Date.now() - new Date(p.dob)) / 31557600000) + ' anos' : null;
        const bmi = p.height_cm && p.weight_kg ? (p.weight_kg / ((p.height_cm / 100) ** 2)).toFixed(1) : null;
        const meta = [age, p.height_cm ? p.height_cm + ' cm' : null, p.weight_kg ? p.weight_kg + ' kg' : null, bmi ? 'IMC ' + bmi : null].filter(Boolean).join(' · ');
        return `
        <div style="display:flex;align-items:center;gap:8px">
          <div class="avatar" style="width:26px;height:26px;font-size:9px;background:${colors.bg};color:${colors.fg}">${getInitials(p.name)}</div>
          <div>
            <div style="font-weight:500">${p.name}</div>
            ${p.institution_id ? `<div style="font-size:10px;color:var(--text-muted)">ID: ${p.institution_id}</div>` : ''}
            ${meta ? `<div style="font-size:11px;color:var(--text-secondary)">${meta}</div>` : ''}
            ${showNotes && p.health_history ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">📋 ${p.health_history}</div>` : ''}
          </div>
        </div>`;};

      const notesCell = (showEdit) => showEdit ? `
        <div class="notes-cell" data-pid="${p.id}" data-notes="${notes.replace(/"/g, '&quot;')}">
          <span class="notes-text">${notes || '<span style="color:var(--text-muted);font-style:italic">Sem observações</span>'}</span>
          <div class="notes-actions">
            <button class="action-btn" onclick="editNotes('${p.id}', this)">✏️</button>
            ${notes ? `<button class="action-btn danger" onclick="deleteNotes('${p.id}', this)">🗑️</button>` : ''}
          </div>
        </div>` : '—';

      const deleteCell = `
        <button class="action-btn danger" onclick="handleDeletePatient('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
          <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Apagar
        </button>`;

      if (!pReadings.length) {
        tbody.innerHTML += `
          <tr>
            <td data-label="Data">—</td>
            <td data-label="Hora">—</td>
            <td>${nameCell(false)}</td>
            <td data-label="FC">—</td>
            <td data-label="SpO₂">—</td>
            <td data-label="Temp">—</td>
            <td data-label="Observações">${notesCell(true)}</td>
            <td data-label="Estado"><span class="vp vp-none">Sem dados</span></td>
            <td>${deleteCell}</td>
          </tr>`;
        return;
      }

      pReadings.forEach((r, i) => {
        const status = getStatus(r);
        const date = new Date(r.created_at);
        tbody.innerHTML += `
          <tr>
            <td data-label="Data">${date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })}</td>
            <td data-label="Hora" style="font-family:var(--font-mono)">${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</td>
            <td>${nameCell(false)}</td>
            <td data-label="FC">${r.heart_rate != null ? r.heart_rate + ' bpm' : '—'}</td>
            <td data-label="SpO₂">${r.spo2 != null ? r.spo2 + '%' : '—'}</td>
            <td data-label="Temp">${r.temperature != null ? r.temperature + ' °C' : '—'}</td>
            <td data-label="Observações">${notesCell(i === 0)}</td>
            <td data-label="Estado"><span class="vp vp-${status === 'normal' ? 'ok' : status === 'atencao' ? 'warn' : status === 'alerta' ? 'alert' : 'none'}">
              ${status === 'normal' ? 'Normal' : status === 'atencao' ? 'Atenção' : status === 'alerta' ? 'Alerta' : 'Sem dados'}
            </span></td>
            <td>${i === 0 ? deleteCell : ''}</td>
          </tr>`;
      });
    };

    [...withReadings, ...without].forEach(renderRows);
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Erro ao carregar registos.</td></tr>';
  }
}

// ─── Edit / delete notes ──────────────────────────────────────
window.editNotes = (patientId, btn) => {
  const cell = btn.closest('.notes-cell');
  const current = cell.dataset.notes;

  cell.innerHTML = `
    <div style="display:flex;gap:6px;align-items:flex-start;flex-direction:column;width:100%">
      <textarea class="field-input notes-edit-area" style="height:60px;padding:6px 8px;font-size:12px;resize:vertical">${current}</textarea>
      <div style="display:flex;gap:6px">
        <button class="action-btn" onclick="saveNotes('${patientId}', this)">✓ Guardar</button>
        <button class="action-btn" onclick="renderRegistos()">✕ Cancelar</button>
      </div>
    </div>`;
  cell.querySelector('textarea').focus();
};

window.saveNotes = async (patientId, btn) => {
  const cell = btn.closest('.notes-cell');
  const newNotes = cell.querySelector('textarea').value.trim();
  try {
    await updatePatient(patientId, { notes: newNotes });
    // Update local patients array
    const p = patients.find(p => p.id === patientId);
    if (p) p.notes = newNotes;
    showToast('Observações guardadas!', 'success');
    renderRegistos();
  } catch (e) {
    showToast('Erro ao guardar observações.', 'error');
  }
};

window.deleteNotes = async (patientId, btn) => {
  if (!confirm('Apagar as observações deste utente?')) return;
  try {
    await updatePatient(patientId, { notes: '' });
    const p = patients.find(p => p.id === patientId);
    if (p) p.notes = '';
    showToast('Observações apagadas.');
    renderRegistos();
  } catch (e) {
    showToast('Erro ao apagar observações.', 'error');
  }
};

// ─── Export CSV ───────────────────────────────────────────────
async function exportCSV() {
  try {
    const readings = await getAllReadings(1000);
    const rows = [['Data', 'Hora', 'Utente', 'FC (bpm)', 'SpO2 (%)', 'Temp (°C)', 'Queda', 'Observações']];
    patients.forEach(p => {
      const pReadings = readings.filter(r => r.patient_id === p.id);
      const notes = p.notes || '';
      if (!pReadings.length) { rows.push(['—', '—', p.name, '—', '—', '—', '—', notes]); return; }
      pReadings.forEach(r => {
        const d = new Date(r.created_at);
        rows.push([d.toLocaleDateString('pt-PT'), d.toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' }), p.name, r.heart_rate ?? '', r.spo2 ?? '', r.temperature ?? '', r.fall_detected ? 'Sim' : 'Não', notes]);
      });
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'vitalguard_registos.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado!', 'success');
  } catch (e) { showToast('Erro ao exportar.', 'error'); }
}

// ─── Settings ─────────────────────────────────────────────────
function initSettings() {
  document.getElementById('s-hr-high').value   = THRESHOLDS.hr_high;
  document.getElementById('s-hr-low').value    = THRESHOLDS.hr_low;
  document.getElementById('s-spo2-warn').value = THRESHOLDS.spo2_warn;
  document.getElementById('s-spo2-alert').value= THRESHOLDS.spo2_alert;
  document.getElementById('s-temp-warn').value = THRESHOLDS.temp_warn;
  document.getElementById('s-temp-alert').value= THRESHOLDS.temp_alert;

  const notifPref = localStorage.getItem('vg_notif') || 'all';
  document.querySelectorAll('[name="notif-pref"]').forEach(r => { r.checked = r.value === notifPref; });

  document.getElementById('settings-save').addEventListener('click', () => {
    THRESHOLDS.hr_high    = parseFloat(document.getElementById('s-hr-high').value);
    THRESHOLDS.hr_low     = parseFloat(document.getElementById('s-hr-low').value);
    THRESHOLDS.spo2_warn  = parseFloat(document.getElementById('s-spo2-warn').value);
    THRESHOLDS.spo2_alert = parseFloat(document.getElementById('s-spo2-alert').value);
    THRESHOLDS.temp_warn  = parseFloat(document.getElementById('s-temp-warn').value);
    THRESHOLDS.temp_alert = parseFloat(document.getElementById('s-temp-alert').value);
    saveThresholds();
    const sel = document.querySelector('[name="notif-pref"]:checked');
    if (sel) localStorage.setItem('vg_notif', sel.value);
    showToast('Definições guardadas!', 'success');
  });

  document.getElementById('settings-reset').addEventListener('click', () => {
    localStorage.removeItem('vg_thresholds');
    THRESHOLDS = { hr_high:100, hr_low:50, spo2_warn:94, spo2_alert:90, temp_warn:37.5, temp_alert:38.5 };
    initSettings();
    showToast('Definições repostas.');
  });
}

// ─── Helpers ──────────────────────────────────────────────────
function getStatus(r) {
  if (!r) return 'sem-dados';
  if (r.fall_detected) return 'alerta';
  if (r.spo2 != null && r.spo2 < THRESHOLDS.spo2_alert) return 'alerta';
  if (r.temperature != null && r.temperature > THRESHOLDS.temp_alert) return 'alerta';
  if (r.heart_rate != null && (r.heart_rate > THRESHOLDS.hr_high || r.heart_rate < THRESHOLDS.hr_low)) return 'atencao';
  if (r.spo2 != null && r.spo2 < THRESHOLDS.spo2_warn) return 'atencao';
  if (r.temperature != null && r.temperature > THRESHOLDS.temp_warn) return 'atencao';
  return 'normal';
}
function getInitials(name) { return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function formatReading(r) {
  if (!r) return 'Sem dados';
  const parts = [];
  if (r.heart_rate != null) parts.push(`FC ${r.heart_rate}bpm`);
  if (r.spo2 != null) parts.push(`SpO₂ ${r.spo2}%`);
  if (r.temperature != null) parts.push(`${r.temperature}°C`);
  return parts.join(' · ') || 'Sem dados';
}
const PALETTE = [
  {bg:'#B5D4F4',fg:'#0C447C'},{bg:'#F5C4B3',fg:'#712B13'},
  {bg:'#C0DD97',fg:'#27500A'},{bg:'#D3D1C7',fg:'#444441'},
  {bg:'#F7C1C1',fg:'#791F1F'},{bg:'#FAC775',fg:'#854F0B'},
];
function avatarColors(id) {
  const idx = (typeof id === 'string' ? id.charCodeAt(0) : id) % PALETTE.length;
  return PALETTE[idx];
}
export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = type ? `show ${type}` : 'show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 3000);
}

window.goTo = goTo;
window.renderRegistos = renderRegistos;
