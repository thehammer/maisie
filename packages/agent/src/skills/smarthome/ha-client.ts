interface HaConfig {
  host: string;
  port: number;
  token: string;
}

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
}

export function createHaClient(config: HaConfig) {
  const baseUrl = `http://${config.host}:${config.port}/api`;

  async function request(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`HA API ${res.status}: ${res.statusText} — ${path}`);
    }

    return res.json();
  }

  return {
    // Health check
    async ping(): Promise<{ message: string }> {
      return request("/");
    },

    // Get all entity states
    async getStates(): Promise<HaState[]> {
      return request("/states");
    },

    // Get a single entity's state
    async getState(entityId: string): Promise<HaState> {
      return request(`/states/${entityId}`);
    },

    // Get states filtered by domain (e.g., "light", "switch", "scene")
    async getByDomain(domain: string): Promise<HaState[]> {
      const states = await request("/states");
      return states.filter((s: HaState) => s.entity_id.startsWith(`${domain}.`));
    },

    // Call a service (e.g., turn on a light, trigger a scene)
    async callService(
      domain: string,
      service: string,
      data: Record<string, any> = {},
    ): Promise<HaState[]> {
      return request(`/services/${domain}/${service}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },

    // Convenience: turn on/off an entity
    async turnOn(entityId: string, data: Record<string, any> = {}): Promise<HaState[]> {
      const domain = entityId.split(".")[0];
      return request(`/services/${domain}/turn_on`, {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId, ...data }),
      });
    },

    async turnOff(entityId: string): Promise<HaState[]> {
      const domain = entityId.split(".")[0];
      return request(`/services/${domain}/turn_off`, {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId }),
      });
    },

    // Convenience: set light brightness/color
    async setLight(
      entityId: string,
      opts: { brightness?: number; rgb?: [number, number, number]; color_temp?: number },
    ): Promise<HaState[]> {
      return request("/services/light/turn_on", {
        method: "POST",
        body: JSON.stringify({
          entity_id: entityId,
          brightness_pct: opts.brightness,
          rgb_color: opts.rgb,
          color_temp: opts.color_temp,
        }),
      });
    },

    // Trigger a scene
    async triggerScene(sceneEntityId: string): Promise<HaState[]> {
      return request("/services/scene/turn_on", {
        method: "POST",
        body: JSON.stringify({ entity_id: sceneEntityId }),
      });
    },

    // Get all scenes
    async getScenes(): Promise<HaState[]> {
      return this.getByDomain("scene");
    },

    // Get all lights
    async getLights(): Promise<HaState[]> {
      return this.getByDomain("light");
    },

    // Get all switches
    async getSwitches(): Promise<HaState[]> {
      return this.getByDomain("switch");
    },
  };
}

export function createHaClientFromEnv() {
  const host = process.env.HA_HOST;
  const token = process.env.HA_TOKEN;

  if (!host || !token) {
    return null;
  }

  return createHaClient({
    host,
    port: Number(process.env.HA_PORT) || 8123,
    token,
  });
}
