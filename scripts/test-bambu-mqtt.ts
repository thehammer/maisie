import { join } from "path";
import * as tls from "tls";

const envPath = join(import.meta.dir, "..", ".env");
const envText = await Bun.file(envPath).text();
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  process.env[trimmed.substring(0, eq)] = trimmed.substring(eq + 1);
}

// Bambu X1C MQTT connection
const PRINTER_IP = process.env.BAMBU_HOST;
const SERIAL = process.env.BAMBU_SERIAL;
const ACCESS_CODE = process.env.BAMBU_ACCESS_CODE;
if (!PRINTER_IP || !SERIAL || !ACCESS_CODE) {
  console.error("Missing required env vars: BAMBU_HOST, BAMBU_SERIAL, BAMBU_ACCESS_CODE");
  process.exit(1);
}
const PORT = 8883;

// MQTT with raw TLS - Bambu uses MQTT 3.1.1 over TLS
// Using mqtt.js library would be cleaner but let's test connectivity first

import mqtt from "mqtt";

const client = mqtt.connect(`mqtts://${PRINTER_IP}:${PORT}`, {
  username: "bblp",
  password: ACCESS_CODE,
  rejectUnauthorized: false,
  protocolVersion: 4, // MQTT 3.1.1
  connectTimeout: 10000,
});

client.on("connect", () => {
  console.log("Connected to X1C MQTT broker!\n");

  // Subscribe to report topic
  const topic = `device/${SERIAL}/report`;
  client.subscribe(topic, (err) => {
    if (err) {
      console.error("Subscribe error:", err);
    } else {
      console.log(`Subscribed to: ${topic}`);
      console.log("Waiting for messages...\n");
    }
  });

  // Request a push of current status
  const requestTopic = `device/${SERIAL}/request`;
  client.publish(requestTopic, JSON.stringify({
    pushing: {
      sequence_id: "0",
      command: "pushall",
    }
  }));
  console.log("Requested full status push\n");
});

client.on("message", (_topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    if (data.print) {
      const p = data.print;
      console.log("=== Print Status ===");
      if (p.gcode_state) console.log(`  State: ${p.gcode_state}`);
      if (p.mc_percent !== undefined) console.log(`  Progress: ${p.mc_percent}%`);
      if (p.mc_remaining_time !== undefined) console.log(`  Remaining: ${p.mc_remaining_time} min`);
      if (p.subtask_name) console.log(`  File: ${p.subtask_name}`);
      if (p.nozzle_temper !== undefined) console.log(`  Nozzle: ${p.nozzle_temper}°C / ${p.nozzle_target_temper}°C`);
      if (p.bed_temper !== undefined) console.log(`  Bed: ${p.bed_temper}°C / ${p.bed_target_temper}°C`);
      if (p.chamber_temper !== undefined) console.log(`  Chamber: ${p.chamber_temper}°C`);
      if (p.spd_lvl !== undefined) console.log(`  Speed: ${p.spd_lvl}`);
      if (p.wifi_signal) console.log(`  WiFi: ${p.wifi_signal}`);
      if (p.layer_num !== undefined) console.log(`  Layer: ${p.layer_num}`);
      if (p.fan_gear) console.log(`  Fan: ${p.fan_gear}`);
      if (p.ams) {
        console.log(`  AMS:`);
        for (const unit of p.ams.ams || []) {
          for (const tray of unit.tray || []) {
            if (tray.tray_type) {
              console.log(`    Slot ${tray.id}: ${tray.tray_type} (${tray.tray_color || "?"})`);
            }
          }
        }
      }
      console.log("");
    }
  } catch {
    console.log("Raw message:", message.toString().substring(0, 200));
  }
});

client.on("error", (err) => {
  console.error("MQTT error:", err.message);
});

client.on("close", () => {
  console.log("Connection closed");
});

// Run for 15 seconds then exit
setTimeout(() => {
  console.log("Done — disconnecting");
  client.end();
  process.exit(0);
}, 15000);
