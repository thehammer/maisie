import mqtt from "mqtt";
import type { MqttClient } from "mqtt";

export interface BambuPrintStatus {
  state: string;
  progress: number;
  remainingMinutes: number;
  fileName: string;
  nozzleTemp: number;
  nozzleTarget: number;
  bedTemp: number;
  bedTarget: number;
  chamberTemp: number;
  speed: number;
  wifiSignal: string;
  layer: number;
  filaments: { slot: number; type: string; color: string }[];
}

export interface BambuClient {
  connect(): Promise<void>;
  disconnect(): void;
  getStatus(): BambuPrintStatus | null;
  onStatus(cb: (status: BambuPrintStatus) => void): void;
  requestFullStatus(): void;
}

export function createBambuClient(config: {
  host: string;
  serial: string;
  accessCode: string;
}): BambuClient {
  let client: MqttClient | null = null;
  let lastStatus: BambuPrintStatus | null = null;
  let statusCallbacks: ((status: BambuPrintStatus) => void)[] = [];

  function parseStatus(data: any): BambuPrintStatus | null {
    const p = data.print;
    if (!p) return null;

    const filaments: BambuPrintStatus["filaments"] = [];
    if (p.ams?.ams) {
      for (const unit of p.ams.ams) {
        for (const tray of unit.tray || []) {
          if (tray.tray_type) {
            filaments.push({
              slot: parseInt(tray.id),
              type: tray.tray_type,
              color: tray.tray_color || "",
            });
          }
        }
      }
    }

    return {
      state: p.gcode_state || "UNKNOWN",
      progress: p.mc_percent ?? 0,
      remainingMinutes: p.mc_remaining_time ?? 0,
      fileName: p.subtask_name || "",
      nozzleTemp: p.nozzle_temper ?? 0,
      nozzleTarget: p.nozzle_target_temper ?? 0,
      bedTemp: p.bed_temper ?? 0,
      bedTarget: p.bed_target_temper ?? 0,
      chamberTemp: p.chamber_temper ?? 0,
      speed: p.spd_lvl ?? 0,
      wifiSignal: p.wifi_signal || "",
      layer: p.layer_num ?? 0,
      filaments,
    };
  }

  return {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        client = mqtt.connect(`mqtts://${config.host}:8883`, {
          username: "bblp",
          password: config.accessCode,
          rejectUnauthorized: false,
          protocolVersion: 4,
          connectTimeout: 10000,
          reconnectPeriod: 30000,
        });

        client.on("connect", () => {
          const topic = `device/${config.serial}/report`;
          client!.subscribe(topic, (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`[bambu] Connected and subscribed to ${config.serial}`);
              resolve();
            }
          });
        });

        client.on("message", (_topic, message) => {
          try {
            const data = JSON.parse(message.toString());
            const status = parseStatus(data);
            if (status) {
              lastStatus = status;
              for (const cb of statusCallbacks) {
                cb(status);
              }
            }
          } catch {
            // ignore parse errors
          }
        });

        client.on("error", (err) => {
          console.error("[bambu] MQTT error:", err.message);
        });

        setTimeout(() => reject(new Error("Connection timeout")), 15000);
      });
    },

    disconnect() {
      if (client) {
        client.end();
        client = null;
      }
    },

    getStatus(): BambuPrintStatus | null {
      return lastStatus;
    },

    onStatus(cb: (status: BambuPrintStatus) => void) {
      statusCallbacks.push(cb);
    },

    requestFullStatus() {
      if (!client) return;
      const topic = `device/${config.serial}/request`;
      client.publish(topic, JSON.stringify({
        pushing: {
          sequence_id: "0",
          command: "pushall",
        },
      }));
    },
  };
}

export function createBambuClientFromEnv(): BambuClient | null {
  const host = process.env.BAMBU_HOST;
  const serial = process.env.BAMBU_SERIAL;
  const accessCode = process.env.BAMBU_ACCESS_CODE;

  if (!host || !serial || !accessCode) {
    return null;
  }

  return createBambuClient({ host, serial, accessCode });
}
