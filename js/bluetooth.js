// js/bluetooth.js
const SERVICE_UUID        = '12345678-1234-1234-1234-123456789abc';
const CHAR_HEART_RATE     = '12345678-1234-1234-1234-123456789ab1';
const CHAR_SPO2           = '12345678-1234-1234-1234-123456789ab2';
const CHAR_TEMPERATURE    = '12345678-1234-1234-1234-123456789ab3';
const CHAR_FALL           = '12345678-1234-1234-1234-123456789ab4';

let device = null;
let onDataCallback = null;
let onDisconnectCallback = null;

export function isSupported() { return 'bluetooth' in navigator; }
export function isConnected() { return device !== null && device.gatt.connected; }
export function getDeviceName() { return device ? device.name : null; }

export async function connect(onData, onDisconnect) {
  if (!isSupported()) throw new Error('Web Bluetooth não suportado.');
  onDataCallback = onData;
  onDisconnectCallback = onDisconnect;

  device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    optionalServices: [SERVICE_UUID],
  });
  device.addEventListener('gattserverdisconnected', handleDisconnect);

  const server  = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);

  const hrChar   = await service.getCharacteristic(CHAR_HEART_RATE);
  const spo2Char = await service.getCharacteristic(CHAR_SPO2);
  const tempChar = await service.getCharacteristic(CHAR_TEMPERATURE);
  const fallChar = await service.getCharacteristic(CHAR_FALL);

  await startNotify(hrChar,   'heart_rate',   v => v.getUint16(0, true));
  await startNotify(spo2Char, 'spo2',         v => v.getUint8(0));
  await startNotify(tempChar, 'temperature',  v => Math.round(v.getFloat32(0, true) * 10) / 10);
  await startNotify(fallChar, 'fall_detected',v => v.getUint8(0) === 1);

  return device.name;
}

export async function disconnect() {
  if (device && device.gatt.connected) device.gatt.disconnect();
  reset();
}

async function startNotify(char, key, parser) {
  await char.startNotifications();
  char.addEventListener('characteristicvaluechanged', (e) => {
    if (onDataCallback) onDataCallback({ [key]: parser(e.target.value), timestamp: new Date() });
  });
}

function handleDisconnect() { reset(); if (onDisconnectCallback) onDisconnectCallback(); }

function reset() {
  device = null;
  onDataCallback = null;
  onDisconnectCallback = null;
}
