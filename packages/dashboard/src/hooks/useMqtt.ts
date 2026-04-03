import { useEffect, useRef, useCallback, useState } from "react";
import mqtt, { type MqttClient } from "mqtt";

type MessageHandler = (topic: string, payload: Record<string, unknown>) => void;

interface UseMqttOptions {
  url?: string;
  topics: string[];
  onMessage: MessageHandler;
}

export function useMqtt({ url, topics, onMessage }: UseMqttOptions) {
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<MqttClient | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    // On HTTPS, connect via Caddy's /mqtt proxy (wss) to avoid mixed-content blocks.
    // On plain HTTP (local dev), connect directly to mosquitto on port 9001.
    const brokerUrl = url || (
      window.location.protocol === "https:"
        ? `wss://${window.location.hostname}/mqtt`
        : `ws://${window.location.hostname}:9001`
    );
    const client = mqtt.connect(brokerUrl, {
      clientId: `maisie-dashboard-${Date.now()}`,
      clean: true,
      reconnectPeriod: 3000,
    });

    clientRef.current = client;

    client.on("connect", () => {
      setConnected(true);
      if (topics.length > 0) {
        client.subscribe(topics);
      }
    });

    client.on("close", () => setConnected(false));

    client.on("message", (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        onMessageRef.current(topic, payload);
      } catch {
        // ignore non-JSON messages
      }
    });

    return () => {
      client.end(true);
      clientRef.current = null;
    };
  }, [url, topics.join(",")]);

  return { connected };
}
