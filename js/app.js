// js/app.js
// Main application logic — navigation, UI updates, data loading

import { requireAuth, logout } from './auth.js';
import { connect, disconnect, isConnected, isSupported, getDeviceName } from './bluetooth.js';
import {
  getPatients, addPatient, deletePatient,
  saveReading, getAllReadings, getLatestReading,
  getAlerts, createAlert, clearAlerts
} from './db.js';

// ─── State ────────────────────────────────────────────────────
let patients = [];
let alerts = [];
let currentReading = { heart_rate: null, spo2: null, temperature: null, fall_detected: false };
let selectedPatientId = null;
let activeFilter = 'todos';

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth();
  if (!user) return;

  document.getElementById('user-email').textContent = user.email;

  await loadPatients();
  await loadAlerts();
  renderHome();
  renderRegistos();

  // Navigation
  document.querySelectorAll('.sb-item[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.screen));
  });

  // BLE button
  document.getElementById('ble-btn').addEventListener('click', toggleBluetooth);

  // Search
  document.getElementById('tr-search').addEventListener('input', filterRealtimeTable);

  // Filter chips
  document.querySelectorAll('[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => setFilter(chip));
  });

  // Form submit
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
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Export
  document.getElementById('export-btn').addEventListener('click', exportCSV);
});

// ─── Navigation ───────────────────────────────────────────────
const screenMeta = {
  home:      { title: 'Painel de controlo', live: false },
  realtime:  { title: 'Tempo real',         live: true  },
  registos:  { title: 'Registos',           live: false },
  adicionar: { title: 'Adicionar utente',   live: false },
};

export function goTo(name) {
  document.querySelectorAll('.sb-item[data-screen]').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === name)
  );
  document.querySelectorAll('.screen').forEach(s =>
    s.classList.toggle('active', s.id === 'screen-' + name)
  );
  document.getElementById('topbar-title').textContent = screenMeta[name].title;
  document.getElementById('live-badge').style.display = screenMeta[name].live ? 'inline-flex' : 'none';

  if (name === 'realtime') renderRealtimeTable();
  if (name === 'registos') renderRegistos();
  if (name === 'home') renderHome();
}

// ─── Data loaders ─────────────────────────────────────────────
async function loadPatients() {
  try {
    patients = await getPatients();
  } catch (e) {
    showToast('Erro ao carregar utentes.', 'error');
  }
}

async function loadAlerts() {
  try {
    alerts = await getAlerts();
    renderAlerts();
  } catch (e) {
    console.error('Erro ao carregar alertas:', e);
  }
}

// ─── Home screen ──────────────────────────────────────────────
async function renderHome() {
  // Stats
  let normal = 0, atencao = 0, alertCount = 0;
  for (const p of patients) {
    const r = await getLatestReading(p.id);
    const status = getStatus(r);
    if (status === 'normal') normal++;
    else if (status === 'atencao') atencao++;
    else if (status === 'alerta') alertCount++;
  }

  document.getElementById('stat-total').textContent = patients.length;
  document.getElementById('stat-normal').textContent = normal;
  document.getElementById('stat-atencao').textContent = atencao;
  document.getElementById('stat-alerta').textContent = alertCount;

  // Recent patients list
  const list = document.getElementById('recent-patients');
  list.innerHTML = '';
  const recent = patients.slice(0, 6);
  for (const p of recent) {
    const r = await getLatestReading(p.id);
    const status = getStatus(r);
    const initials = getInitials(p.name);
    const colors = avatarColors(p.id);
    list.innerHTML += `
      <div class="patient-row" onclick="goTo('realtime')">
        <div class="avatar" style="background:${colors.bg};color:${colors.fg}">${initials}</div>
        <div>
          <div class="p-name">${p.name}</div>
          <div class="p-sub">${formatReading(r)}</div>
        </div>
        <span class="badge badge-${status === 'normal' ? 'ok' : status === 'atencao' ? 'warn' : 'alert'}">
          ${status === 'normal' ? 'Normal' : status === 'atencao' ? 'Atenção' : 'Alerta'}
        </span>
      </div>`;
  }
  if (recent.length === 0) list.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:16px 0">Sem utentes registados.</div>';
}

// ─── Alerts ───────────────────────────────────────────────────
function renderAlerts() {
  const panel = document.getElementById('notif-list');
  const badge = document.getElementById('bell-badge');
  const header = document.getElementById('notif-count');

  if (alerts.length === 0) {
    panel.innerHTML = '<div class="notif-empty">Sem alertas recentes.</div>';
    badge.style.display = 'none';
    header.textContent = 'Notificações';
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
  try {
    await clearAlerts();
    alerts = [];
    renderAlerts();
    showToast('Alertas limpos.');
  } catch (e) {
    showToast('Erro ao limpar alertas.', 'error');
  }
}

// ─── Realtime screen ──────────────────────────────────────────
async function renderRealtimeTable() {
  const tbody = document.getElementById('rt-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="6"><div class="loading"><div class="spinner"></div>A carregar...</div></td></tr>';

  const rows = [];
  for (const p of patients) {
    const r = await getLatestReading(p.id);
    rows.push({ patient: p, reading: r });
  }

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Sem utentes registados.</td></tr>';
    return;
  }

  rows.forEach(({ patient, reading }) => {
    const status = getStatus(reading);
    const initials = getInitials(patient.name);
    const colors = avatarColors(patient.id);
    const searchQ = activeFilter;
    const visible = searchQ === 'todos' || status === searchQ;

    const tr = document.createElement('tr');
    tr.dataset.status = status;
    tr.dataset.name = patient.name.toLowerCase();
    tr.style.display = visible ? '' : 'none';
    tr.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:30px;height:30px;font-size:10px;background:${colors.bg};color:${colors.fg}">${initials}</div>
          ${patient.name}
        </div>
      </td>
      <td data-label="FC">${reading?.heart_rate != null ? reading.heart_rate + ' bpm' : '—'}</td>
      <td data-label="SpO₂">${reading?.spo2 != null ? reading.spo2 + '%' : '—'}</td>
      <td data-label="Temp">${reading?.temperature != null ? reading.temperature + ' °C' : '—'}</td>
      <td data-label="Queda">${reading?.fall_detected ? '<span style="color:#E24B4A;font-weight:500">⚠ Queda</span>' : '—'}</td>
      <td data-label="Estado"><span class="vp vp-${status === 'normal' ? 'ok' : status === 'atencao' ? 'warn' : status === 'alerta' ? 'alert' : 'none'}">
        ${status === 'normal' ? 'Normal' : status === 'atencao' ? 'Atenção' : status === 'alerta' ? 'Alerta' : 'Sem dados'}
      </span></td>`;
    tbody.appendChild(tr);
  });
}

function filterRealtimeTable() {
  const q = document.getElementById('tr-search').value.toLowerCase();
  document.querySelectorAll('#rt-tbody tr').forEach(row => {
    const matchFilter = activeFilter === 'todos' || row.dataset.status === activeFilter;
    const matchSearch = (row.dataset.name || '').includes(q);
    row.style.display = matchFilter && matchSearch ? '' : 'none';
  });
}

function setFilter(el) {
  document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  activeFilter = el.dataset.filter;
  filterRealtimeTable();
}

// ─── Vitals cards (live reading from BLE) ─────────────────────
function updateVitalCards(reading) {
  setVital('hr',   reading.heart_rate,   'bpm',  v => v > 100 || v < 50 ? 'alert' : v > 90 ? 'warn' : 'ok');
  setVital('spo2', reading.spo2,         '%',    v => v < 90 ? 'alert' : v < 94 ? 'warn' : 'ok');
  setVital('temp', reading.temperature,  '°C',   v => v > 37.5 ? 'warn' : v > 38.5 ? 'alert' : 'ok');

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

function setVital(key, value, unit, statusFn) {
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
    label.textContent = 'Ligar dispositivo';
    selectedPatientId = null;
    showToast('Dispositivo desligado.');
    return;
  }

  if (!isSupported()) {
    showToast('Web Bluetooth não suportado neste browser. Use o Chrome.', 'error');
    return;
  }

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
  } catch (e) {
    label.textContent = 'Ligar dispositivo';
    if (e.name !== 'NotFoundError') showToast('Erro: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function onBLEData(data) {
  // Merge new data into current reading
  currentReading = { ...currentReading, ...data };
  updateVitalCards(currentReading);

  // Save to Supabase every time we get a full reading
  if (
    currentReading.heart_rate != null &&
    currentReading.spo2 != null &&
    currentReading.temperature != null
  ) {
    try {
      await saveReading(selectedPatientId, currentReading);

      // Check thresholds and create alerts
      await checkThresholds(currentReading);

      // Refresh realtime table if visible
      if (document.getElementById('screen-realtime').classList.contains('active')) {
        renderRealtimeTable();
      }
    } catch (e) {
      console.error('Erro ao guardar leitura:', e);
    }
  }
}

function onBLEDisconnect() {
  const btn = document.getElementById('ble-btn');
  const label = document.getElementById('ble-label');
  btn.classList.remove('connected');
  label.textContent = 'Ligar dispositivo';
  showToast('Dispositivo desligado.', 'error');
}

async function checkThresholds(r) {
  if (!selectedPatientId) return;

  if (r.fall_detected) {
    await createAlert(selectedPatientId, 'alert', 'Queda detectada');
    await loadAlerts();
  }
  if (r.heart_rate > 100 || r.heart_rate < 50) {
    await createAlert(selectedPatientId, 'warn', `FC fora do normal: ${r.heart_rate} bpm`);
    await loadAlerts();
  }
  if (r.spo2 < 94) {
    await createAlert(selectedPatientId, r.spo2 < 90 ? 'alert' : 'warn', `SpO₂ baixo: ${r.spo2}%`);
    await loadAlerts();
  }
  if (r.temperature > 37.5) {
    await createAlert(selectedPatientId, 'warn', `Temperatura elevada: ${r.temperature}°C`);
    await loadAlerts();
  }
}

// ─── Add patient form ─────────────────────────────────────────
async function handleAddPatient(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'A adicionar...';

  const patient = {
    name:    document.getElementById('f-nome').value.trim(),
    phone:   document.getElementById('f-tel').value.trim(),
    email:   document.getElementById('f-email').value.trim(),
    address: document.getElementById('f-morada').value.trim(),
    nif:     document.getElementById('f-nif').value.trim(),
    nhc:     document.getElementById('f-utente').value.trim(),
  };

  try {
    await addPatient(patient);
    await loadPatients();
    clearForm();
    showToast(`Utente "${patient.name}" adicionado!`, 'success');
    setTimeout(() => goTo('home'), 1000);
  } catch (e) {
    showToast('Erro ao adicionar utente: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Adicionar utente';
  }
}

function clearForm() {
  document.getElementById('add-form').reset();
}

// ─── Registos screen ──────────────────────────────────────────
async function renderRegistos() {
  const tbody = document.getElementById('reg-tbody');
  tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><div class="loading"><div class="spinner"></div>A carregar...</div></td></tr>';

  try {
    const readings = await getAllReadings(100);
    tbody.innerHTML = '';

    if (readings.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Sem registos disponíveis.</td></tr>';
      return;
    }

    readings.forEach(r => {
      const name = r.patients?.name || 'Desconhecido';
      const initials = getInitials(name);
      const colors = avatarColors(r.patient_id);
      const status = getStatus(r);
      const date = new Date(r.created_at);

      tbody.innerHTML += `
        <tr>
          <td data-label="Data">${date.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })}</td>
          <td data-label="Hora" style="font-family:var(--font-mono)">${date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="avatar" style="width:26px;height:26px;font-size:9px;background:${colors.bg};color:${colors.fg}">${initials}</div>
              ${name}
            </div>
          </td>
          <td data-label="FC">${r.heart_rate != null ? r.heart_rate + ' bpm' : '—'}</td>
          <td data-label="SpO₂">${r.spo2 != null ? r.spo2 + '%' : '—'}</td>
          <td data-label="Temp">${r.temperature != null ? r.temperature + ' °C' : '—'}</td>
          <td data-label="Estado"><span class="vp vp-${status === 'normal' ? 'ok' : status === 'atencao' ? 'warn' : status === 'alerta' ? 'alert' : 'none'}">
            ${status === 'normal' ? 'Normal' : status === 'atencao' ? 'Atenção' : status === 'alerta' ? 'Alerta' : 'Sem dados'}
          </span></td>
        </tr>`;
    });
  } catch (e) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Erro ao carregar registos.</td></tr>';
  }
}

// ─── Export CSV ───────────────────────────────────────────────
async function exportCSV() {
  const readings = await getAllReadings(1000);
  const rows = [['Data', 'Hora', 'Utente', 'FC (bpm)', 'SpO2 (%)', 'Temp (°C)', 'Queda']];
  readings.forEach(r => {
    const d = new Date(r.created_at);
    rows.push([
      d.toLocaleDateString('pt-PT'),
      d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
      r.patients?.name || '',
      r.heart_rate ?? '',
      r.spo2 ?? '',
      r.temperature ?? '',
      r.fall_detected ? 'Sim' : 'Não',
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'vitalguard_registos.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado!', 'success');
}

// ─── Helpers ──────────────────────────────────────────────────
function getStatus(reading) {
  if (!reading) return 'sem-dados';
  if (reading.fall_detected) return 'alerta';
  if (reading.spo2 != null && reading.spo2 < 90) return 'alerta';
  if (reading.heart_rate != null && (reading.heart_rate > 100 || reading.heart_rate < 50)) return 'atencao';
  if (reading.spo2 != null && reading.spo2 < 94) return 'atencao';
  if (reading.temperature != null && reading.temperature > 37.5) return 'atencao';
  return 'normal';
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatReading(r) {
  if (!r) return 'Sem dados';
  const parts = [];
  if (r.heart_rate != null) parts.push(`FC ${r.heart_rate}bpm`);
  if (r.spo2 != null) parts.push(`SpO₂ ${r.spo2}%`);
  if (r.temperature != null) parts.push(`${r.temperature}°C`);
  return parts.join(' · ') || 'Sem dados';
}

const PALETTE = [
  { bg: '#B5D4F4', fg: '#0C447C' }, { bg: '#F5C4B3', fg: '#712B13' },
  { bg: '#C0DD97', fg: '#27500A' }, { bg: '#D3D1C7', fg: '#444441' },
  { bg: '#F7C1C1', fg: '#791F1F' }, { bg: '#FAC775', fg: '#854F0B' },
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

// Expose goTo globally for inline onclick
window.goTo = goTo;
