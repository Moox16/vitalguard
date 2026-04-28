/*
 * VitalGuard ESP32 — BLE GATT Server
 * ====================================
 * Broadcasts Heart Rate, SpO2, Temperature and Fall Detection
 * over Bluetooth Low Energy to the VitalGuard web app.
 *
 * HARDWARE:
 *   - ESP32 (any variant)
 *   - MAX30102 pulse oximeter sensor  (I2C: SDA=21, SCL=22)
 *   - DS18B20 temperature sensor      (OneWire: GPIO 4)
 *   - MPU6050 accelerometer/gyro      (I2C: SDA=21, SCL=22)
 *
 * LIBRARIES (install via Arduino Library Manager):
 *   - ESP32 BLE Arduino    (built-in with ESP32 board package)
 *   - SparkFun MAX3010x    by SparkFun Electronics
 *   - DallasTemperature    by Miles Burton
 *   - OneWire              by Jim Studt
 *   - Adafruit MPU6050     by Adafruit
 *   - Adafruit Unified Sensor
 *
 * BOARD: "ESP32 Dev Module" in Arduino IDE
 *        Tools > Partition Scheme > "Default 4MB with spiffs"
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <Wire.h>
#include "MAX30105.h"
#include "spo2_algorithm.h"
#include "heartRate.h"

#include <OneWire.h>
#include <DallasTemperature.h>

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// ─── UUIDs — must match js/bluetooth.js exactly ──────────────
#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHAR_HEART_RATE     "12345678-1234-1234-1234-123456789ab1"
#define CHAR_SPO2           "12345678-1234-1234-1234-123456789ab2"
#define CHAR_TEMPERATURE    "12345678-1234-1234-1234-123456789ab3"
#define CHAR_FALL           "12345678-1234-1234-1234-123456789ab4"
// ─────────────────────────────────────────────────────────────

// ─── Pins ────────────────────────────────────────────────────
#define ONE_WIRE_PIN  4     // DS18B20 data pin
#define LED_PIN       2     // Built-in LED (status indicator)
// ─────────────────────────────────────────────────────────────

// ─── Sensors ─────────────────────────────────────────────────
MAX30105 particleSensor;
OneWire oneWire(ONE_WIRE_PIN);
DallasTemperature tempSensor(&oneWire);
Adafruit_MPU6050 mpu;

// ─── BLE ─────────────────────────────────────────────────────
BLEServer*          pServer    = nullptr;
BLECharacteristic*  pHR        = nullptr;
BLECharacteristic*  pSpO2      = nullptr;
BLECharacteristic*  pTemp      = nullptr;
BLECharacteristic*  pFall      = nullptr;
bool                connected  = false;

// ─── SpO2 / HR buffers ───────────────────────────────────────
#define BUFFER_SIZE 100
uint32_t irBuffer[BUFFER_SIZE];
uint32_t redBuffer[BUFFER_SIZE];
int32_t  spo2Value      = 0;
int8_t   spo2Valid      = 0;
int32_t  heartRateValue = 0;
int8_t   hrValid        = 0;

// ─── Fall detection ──────────────────────────────────────────
#define FALL_THRESHOLD 2.5   // g-force threshold
bool fallDetected = false;
unsigned long fallClearTime = 0;
#define FALL_DISPLAY_MS 10000  // show fall alert for 10 seconds

// ─── Timing ──────────────────────────────────────────────────
unsigned long lastNotify = 0;
#define NOTIFY_INTERVAL_MS 1000  // send data every 1 second

// ─── BLE Callbacks ───────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    connected = true;
    digitalWrite(LED_PIN, HIGH);
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer* s) override {
    connected = false;
    digitalWrite(LED_PIN, LOW);
    Serial.println("[BLE] Client disconnected — advertising again");
    BLEDevice::startAdvertising();
  }
};

// ─── Setup ───────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Wire.begin();

  // MAX30102
  if (!particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("[ERROR] MAX30102 not found. Check wiring.");
    while (1);
  }
  particleSensor.setup();
  particleSensor.setPulseAmplitudeRed(0x0A);
  particleSensor.setPulseAmplitudeGreen(0);
  Serial.println("[OK] MAX30102 ready");

  // DS18B20
  tempSensor.begin();
  Serial.println("[OK] DS18B20 ready");

  // MPU6050
  if (!mpu.begin()) {
    Serial.println("[WARN] MPU6050 not found — fall detection disabled");
  } else {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
    Serial.println("[OK] MPU6050 ready");
  }

  // BLE
  BLEDevice::init("VitalGuard");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  auto makeChar = [&](const char* uuid) {
    return pService->createCharacteristic(
      uuid,
      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_NOTIFY
    );
  };

  pHR   = makeChar(CHAR_HEART_RATE);
  pSpO2 = makeChar(CHAR_SPO2);
  pTemp = makeChar(CHAR_TEMPERATURE);
  pFall = makeChar(CHAR_FALL);

  // Enable notifications (CCCD descriptor)
  pHR->addDescriptor(new BLE2902());
  pSpO2->addDescriptor(new BLE2902());
  pTemp->addDescriptor(new BLE2902());
  pFall->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising* pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising as 'VitalGuard'...");
}

// ─── Loop ────────────────────────────────────────────────────
void loop() {
  // Read 100 samples from MAX30102 for SpO2/HR calculation
  for (int i = 0; i < BUFFER_SIZE; i++) {
    while (!particleSensor.available()) particleSensor.check();
    redBuffer[i] = particleSensor.getRed();
    irBuffer[i]  = particleSensor.getIR();
    particleSensor.nextSample();
  }

  maxim_heart_rate_and_oxygen_saturation(
    irBuffer, BUFFER_SIZE, redBuffer,
    &spo2Value, &spo2Valid,
    &heartRateValue, &hrValid
  );

  // Temperature
  tempSensor.requestTemperatures();
  float tempC = tempSensor.getTempCByIndex(0);

  // Fall detection via MPU6050
  sensors_event_t accel, gyro, temp_event;
  mpu.getEvent(&accel, &gyro, &temp_event);
  float totalG = sqrt(
    accel.acceleration.x * accel.acceleration.x +
    accel.acceleration.y * accel.acceleration.y +
    accel.acceleration.z * accel.acceleration.z
  ) / 9.81;

  if (totalG > FALL_THRESHOLD) {
    fallDetected = true;
    fallClearTime = millis() + FALL_DISPLAY_MS;
    Serial.printf("[FALL] Detected! G-force: %.2f\n", totalG);
  }
  if (fallDetected && millis() > fallClearTime) {
    fallDetected = false;
  }

  // Notify connected client at interval
  if (connected && millis() - lastNotify >= NOTIFY_INTERVAL_MS) {
    lastNotify = millis();

    uint16_t hr   = hrValid   ? (uint16_t)heartRateValue : 0;
    uint8_t  spo2 = spo2Valid ? (uint8_t)spo2Value       : 0;
    uint8_t  fall = fallDetected ? 1 : 0;

    pHR->setValue((uint8_t*)&hr, 2);
    pHR->notify();

    pSpO2->setValue(&spo2, 1);
    pSpO2->notify();

    pTemp->setValue((uint8_t*)&tempC, 4);
    pTemp->notify();

    pFall->setValue(&fall, 1);
    pFall->notify();

    Serial.printf("[TX] HR=%dbpm  SpO2=%d%%  Temp=%.1f°C  Fall=%s\n",
      hr, spo2, tempC, fall ? "YES" : "no");
  }
}
