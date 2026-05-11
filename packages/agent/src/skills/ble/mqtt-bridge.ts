/**
 * BLE MQTT Bridge — connects the BLE gateway (Python) to the agent registry.
 *
 * Subscribes to gateway MQTT topics and routes events to the registry.
 * Also provides methods to send commands to devices via the gateway.
 */

import { subscribe, publish, getMqttClient } from "../../services/mqtt";
import { TOPICS } from "../../topics";
import type { createBleRegistry } from "./registry";

type BleRegistry = ReturnType<typeof createBleRegistry>;

export function createBleMqttBridge(registry: BleRegistry) {
  /** Subscribe to all BLE gateway topics and wire them to the registry. */
  function start() {
    // New device discovered
    subscribe(TOPICS.ble.devices.discovered, (payload) => {
      const p = payload as any;
      if (p.gatewayNode) registry.touchGatewayNode(p.gatewayNode);
      registry.handleDiscovery(p);
    });

    // Batch update (every 10 scans)
    subscribe(TOPICS.ble.devices.updated, (payload) => {
      const p = payload as any;
      if (p.gatewayNode) registry.touchGatewayNode(p.gatewayNode);
      registry.handleDiscovery(p);
    });

    // Gateway status heartbeat — auto-registers node, updates lastSeen
    subscribe("home/ble/gateway/+/status", (payload) => {
      const p = payload as any;
      if (p.node) registry.touchGatewayNode(p.node);
    });

    // Device lost
    subscribe(TOPICS.ble.devices.lost, (payload) => {
      const mac = payload.mac as string;
      const device = registry.getDevice(mac);
      if (device && device.ownership === "home") {
        publish(TOPICS.ble.devices.lost, {
          ...payload,
          label: device.label,
          room: device.room,
        });
      }
    });
  }

  /**
   * Send a command to a BLE device via the gateway.
   * Returns a promise that resolves when the command result arrives.
   */
  async function sendCommand(
    mac: string,
    protocol: string,
    command: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
    const macHex = mac.replace(/:/g, "");
    const commandTopic = TOPICS.ble.command(mac);
    const resultTopic = TOPICS.ble.commandResult(mac);

    return new Promise((resolve) => {
      const client = getMqttClient();
      client.subscribe(resultTopic);

      const timer = setTimeout(() => {
        client.removeListener("message", onMessage);
        client.unsubscribe(resultTopic);
        resolve({ success: false, error: "Command timed out" });
      }, timeoutMs);

      function onMessage(t: string, message: Buffer) {
        if (t !== resultTopic) return;
        clearTimeout(timer);
        client.removeListener("message", onMessage);
        client.unsubscribe(resultTopic);
        try {
          const payload = JSON.parse(message.toString());
          resolve({
            success: payload.success as boolean,
            result: payload.result as Record<string, unknown>,
            error: payload.error as string | undefined,
          });
        } catch {
          resolve({ success: false, error: "Failed to parse command result" });
        }
      }

      client.on("message", onMessage);

      // Publish the command
      publish(commandTopic, {
        protocol,
        command,
        params,
      });
    });
  }

  /**
   * Request the gateway to characterize a device (connect + enumerate GATT).
   */
  async function characterizeDevice(mac: string, protocol = "generic") {
    const result = await sendCommand(mac, protocol, "characterize", {}, 20_000);
    if (result.success && result.result?.capabilities) {
      registry.setCapabilities(
        mac,
        result.result.capabilities as Record<string, string[]>
      );
    }
    return result;
  }

  return {
    start,
    sendCommand,
    characterizeDevice,
  };
}
