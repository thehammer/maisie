interface DakboardConfig {
  apiKey: string;
}

interface DakboardScreen {
  id: number;
  name: string;
  width: number;
  height: number;
  orientation: string;
  status: string;
  version: number;
  is_default: boolean;
}

interface DakboardDevice {
  id: number;
  name: string;
  serial_num: string;
  model: string;
  ip_addr: string;
  last_connect: string;
  screen_id: number;
  screen_type: string;
}

interface DakboardMetric {
  id?: number;
  name: string;
  value: number | string;
  timestamp?: string;
}

export function createDakboardClient(config: DakboardConfig) {
  const baseUrl = "https://dakboard.com/api/2";
  const key = config.apiKey;

  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${separator}api_key=${key}`;

    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...options.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`DAKboard ${res.status}: ${res.statusText} — ${path}`);
    }

    return res.json();
  }

  return {
    // List all screens
    async getScreens(): Promise<DakboardScreen[]> {
      return request("/screens");
    },

    // List all devices
    async getDevices(): Promise<DakboardDevice[]> {
      return request("/devices");
    },

    // Assign a screen to a device
    async setDeviceScreen(
      deviceId: number,
      screenId: number,
    ): Promise<DakboardDevice> {
      return request(`/devices/${deviceId}`, {
        method: "PUT",
        body: `screen_id=${screenId}`,
      });
    },

    // Push a metric value
    async pushMetric(
      metricName: string,
      value: number | string,
    ): Promise<void> {
      await request("/metrics", {
        method: "POST",
        body: `name=${encodeURIComponent(metricName)}&value=${encodeURIComponent(String(value))}`,
      });
    },

    // Push multiple metrics at once
    async pushMetrics(
      metrics: { name: string; value: number | string }[],
    ): Promise<void> {
      for (const m of metrics) {
        await this.pushMetric(m.name, m.value);
      }
    },
  };
}

export function createDakboardClientFromEnv() {
  const apiKey = process.env.DAKBOARD_API_KEY;
  if (!apiKey) return null;
  return createDakboardClient({ apiKey });
}
