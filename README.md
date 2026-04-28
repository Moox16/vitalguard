# VitalGuard

Real-time elderly patient monitoring app. Connects to an ESP32 device via Web Bluetooth and stores vitals (heart rate, SpO₂, temperature, fall detection) in a Supabase database.

---

## Project structure

```
vitalguard/
├── index.html           # Login page
├── dashboard.html       # Main app (all 4 screens)
├── css/
│   └── style.css
├── js/
│   ├── app.js           # Main logic
│   ├── auth.js          # Login / logout
│   ├── bluetooth.js     # Web Bluetooth / ESP32
│   └── db.js            # Supabase read/write
├── esp32/
│   └── vitalguard.ino   # Arduino sketch for the ESP32
└── supabase_schema.sql  # Database tables
```

---

## Setup — 3 steps

### 1. Supabase (database + login)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New project**, give it a name (e.g. `vitalguard`)
3. Once ready, go to **SQL Editor → New query**
4. Paste the contents of `supabase_schema.sql` and click **Run**
5. Go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public** key
6. Open `js/db.js` and replace:
   ```js
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
   ```
7. Create your first user: go to **Authentication → Users → Invite user** and enter your email

---

### 2. ESP32 (hardware)

#### Wiring

| Sensor       | ESP32 pin |
|--------------|-----------|
| MAX30102 SDA | GPIO 21   |
| MAX30102 SCL | GPIO 22   |
| DS18B20 data | GPIO 4    |
| DS18B20 VCC  | 3.3V      |
| DS18B20 GND  | GND       |
| MPU6050 SDA  | GPIO 21   |
| MPU6050 SCL  | GPIO 22   |

> DS18B20 requires a 4.7kΩ resistor between data and VCC.

#### Arduino IDE setup

1. Install [Arduino IDE 2](https://www.arduino.cc/en/software)
2. Add ESP32 board support:
   - Go to **File → Preferences**
   - Add to "Additional boards manager URLs":
     `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Go to **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif**
3. Install libraries via **Tools → Manage Libraries**:
   - `SparkFun MAX3010x Pulse and Proximity Sensor Library`
   - `DallasTemperature`
   - `OneWire`
   - `Adafruit MPU6050`
   - `Adafruit Unified Sensor`
4. Open `esp32/vitalguard.ino`
5. Select **Tools → Board → ESP32 Dev Module**
6. Select the correct **Port**
7. Click **Upload**
8. Open **Serial Monitor** at 115200 baud — you should see `[BLE] Advertising as 'VitalGuard'...`

---

### 3. Host on GitHub Pages (free)

1. Create a free [GitHub](https://github.com) account if you don't have one
2. Click **New repository**, name it `vitalguard`, set to **Public**
3. Upload all project files (drag and drop in the GitHub web interface, or use Git)
4. Go to **Settings → Pages**
5. Under "Branch", select `main` and folder `/root`, click **Save**
6. Your app will be live at `https://YOUR_USERNAME.github.io/vitalguard/`

> ⚠️ Web Bluetooth only works over **HTTPS** (GitHub Pages provides this automatically) and in **Chrome or Edge** on desktop.

---

## Using the app

1. Open your GitHub Pages URL in **Chrome or Edge**
2. Log in with the email you created in Supabase
3. Go to **Adicionar utente** and add a patient
4. Go to **Tempo real**, select the patient from the dropdown, and click **Ligar dispositivo ESP32**
5. The browser will show a Bluetooth device picker — select "VitalGuard"
6. Live vitals will appear and be saved to the database automatically
7. Alerts are created automatically when vitals go out of range:
   - Heart rate < 50 or > 100 bpm → ⚠ Atenção
   - SpO₂ < 94% → ⚠ Atenção / < 90% → 🔴 Alerta
   - Temperature > 37.5°C → ⚠ Atenção
   - Fall detected → 🔴 Alerta

---

## Alert thresholds

| Vital        | Atenção          | Alerta       |
|--------------|------------------|--------------|
| Heart rate   | < 50 or > 100 bpm | —           |
| SpO₂         | < 94%            | < 90%        |
| Temperature  | > 37.5°C         | > 38.5°C     |
| Fall         | —                | Always alert |

These can be adjusted in `js/app.js` inside the `checkThresholds` function.

---

## Customising BLE UUIDs

The UUIDs in `js/bluetooth.js` and `esp32/vitalguard.ino` must match exactly. If you change them in one place, change them in both. You can generate new UUIDs at [uuidgenerator.net](https://www.uuidgenerator.net).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Web Bluetooth not supported" | Use Chrome or Edge on desktop. Firefox does not support Web Bluetooth. |
| Device not found in picker | Make sure the ESP32 is powered and the Serial Monitor shows "Advertising". Move closer. |
| Can't log in | Double-check Supabase URL and anon key in `js/db.js`. Make sure the user was created in Supabase Auth. |
| No data saving | Open browser DevTools (F12) → Console for errors. Check Supabase RLS policies. |
| MAX30102 not found | Check I2C wiring. Try `i2c_scanner` sketch to confirm address is `0x57`. |
