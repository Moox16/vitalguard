// js/bluetooth.js
// Web Bluetooth API — connects to the VitalGuard ESP32 device
// The ESP32 must advertise a BLE GATT service with the UUIDs below.

// ─── GATT UUIDs — must match your ESP32 sketch exactly ───────
const SERVICE_UUID        = '12345678-1234-1234-1234-123456789abc';
const CHAR_HEART_RATE     = '12345678-1234-1234-1234-123456789ab1';
const CHAR_SPO2           = '12345678-1234-1234-1234-123456789ab2';
const CHAR_TEMPERATURE    = '12345678-1234-1234-1234-123456789ab3';
const CHAR_FALL           = '12345678-1234-1234-1234-123456789ab4';
// ─────────────────────────────────────────────────────────────

let device = null;
let server = null;
let characteristics = {};
let onDataCallback = null;
let onDisconnectCallback = null;

export function isSupported() {
  return 'bluetooth' in navigator;
}

export function isConnected() {
  return device !== null && device.gatt.connected;
}

export function getDeviceName() {
  return device ? device.name : null;
}

// Connect to the ESP32 and set up notifications
export async function connect(onData, onDisconnect) {
  if (!isSupported()) throw new Error('Web Bluetooth não é suportado neste browser.');

  onDataCallback = onData;
  onDisconnectCallback = onDisconnect;

  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });

  device.addEventListener('gattserverdisconnected', handleDisconnect);

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);

  // Get all characteristics
  characteristics.heartRate  = await service.getCharacteristic(CHAR_HEART_RATE);
  characteristics.spo2       = await service.getCharacteristic(CHAR_SPO2);
  characteristics.temperature = await service.getCharacteristic(CHAR_TEMPERATURE);
  characteristics.fall       = await service.getCharacteristic(CHAR_FALL);

  // Subscribe to notifications for each characteristic
  await startNotify(characteristics.heartRate,  'heart_rate',  parseUint16);
  await startNotify(characteristics.spo2,       'spo2',        parseUint8);
  await startNotify(characteristics.temperature,'temperature', parseFloat32);
  await startNotify(characteristics.fall,       'fall_detected', parseBool);

  return device.name;
}

export async function disconnect() {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }
  reset();
}

// ─── Internal helpers ─────────────────────────────────────────

async function startNotify(characteristic, key, parser) {
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    const value = parser(event.target.value);
    if (onDataCallback) onDataCallback({ [key]: value, timestamp: new Date() });
  });
}

function handleDisconnect() {
  reset();
  if (onDisconnectCallback) onDisconnectCallback();
}

function reset() {
  device = null;
  server = null;
  characteristics = {};
  onDataCallback = null;
  onDisconnectCallback = null;
}

// ─── Parsers (must match ESP32 data format) ──────────────────

function parseUint16(dataView) {
  return dataView.getUint16(0, true); // little-endian
}

function parseUint8(dataView) {
  return dataView.getUint8(0);
}

function parseFloat32(dataView) {
  const raw = dataView.getFloat32(0, true); // little-endian
  return Math.round(raw * 10) / 10; // 1 decimal place
}

function parseBool(dataView) {
  return dataView.getUint8(0) === 1;
}
