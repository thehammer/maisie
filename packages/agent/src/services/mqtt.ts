import mqtt, { type MqttClient } from "mqtt";

let client: MqttClient | null = null;

export async function createMqttClient(): Promise<MqttClient> {
  const brokerUrl = process.env.MQTT_URL || "mqtt://localhost:1883";

  return new Promise((resolve, reject) => {
    client = mqtt.connect(brokerUrl, {
      clientId: `maisie-agent-${Date.now()}`,
      clean: true,
    });

    client.on("connect", () => resolve(client!));
    client.on("error", reject);
  });
}

export function getMqttClient(): MqttClient {
  if (!client) throw new Error("MQTT client not initialized");
  return client;
}

export function publish(topic: string, payload: Record<string, unknown>) {
  getMqttClient().publish(topic, JSON.stringify(payload));
}

export function subscribe(
  topic: string,
  handler: (payload: Record<string, unknown>, topic: string) => void,
) {
  const c = getMqttClient();
  c.subscribe(topic);
  c.on("message", (t, message) => {
    if (topicMatches(topic, t)) {
      try {
        handler(JSON.parse(message.toString()), t);
      } catch {
        // ignore non-JSON messages
      }
    }
  });
}

/**
 * MQTT wildcard matching:
 *   + matches exactly one topic level
 *   # matches all remaining levels (must be last segment)
 */
export function topicMatches(subscription: string, topic: string): boolean {
  const subParts = subscription.split("/");
  const topicParts = topic.split("/");
  for (let i = 0; i < subParts.length; i++) {
    if (subParts[i] === "#") return true;
    if (i >= topicParts.length) return false;
    if (subParts[i] === "+") continue;
    if (subParts[i] !== topicParts[i]) return false;
  }
  return subParts.length === topicParts.length;
}
