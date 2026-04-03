interface ProtectConfig {
  host: string;
  username: string;
  password: string;
}

export function createProtectClient(config: ProtectConfig) {
  const baseUrl = `https://${config.host}`;
  let cookies: string[] = [];
  let csrfToken: string | null = null;

  async function request(path: string, options: RequestInit = {}): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Cookie: cookies.join("; "),
    };
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookies = setCookie.map((c) => c.split(";")[0]);
    }

    const csrf = res.headers.get("x-csrf-token");
    if (csrf) {
      csrfToken = csrf;
    }

    if (!res.ok) {
      throw new Error(`Protect API ${res.status}: ${res.statusText} — ${path}`);
    }

    return res.json();
  }

  // Login state — same pattern as unifi-client to avoid UDM rate limiting
  let loginPromise: Promise<void> | null = null;
  let lastLoginAttempt = 0;
  const LOGIN_COOLDOWN_MS = 30 * 60 * 1000;

  async function login(): Promise<void> {
    if (loginPromise) return loginPromise;

    const elapsed = Date.now() - lastLoginAttempt;
    if (lastLoginAttempt > 0 && elapsed < LOGIN_COOLDOWN_MS) {
      throw new Error(`Protect login cooldown: ${Math.ceil((LOGIN_COOLDOWN_MS - elapsed) / 1000)}s remaining`);
    }

    lastLoginAttempt = Date.now();
    loginPromise = (async () => {
      try {
        cookies = [];
        await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: config.username,
            password: config.password,
          }),
        });
        lastLoginAttempt = 0;
      } finally {
        loginPromise = null;
      }
    })();

    return loginPromise;
  }

  async function withReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (e.message?.includes("401")) {
        await login();
        return fn();
      }
      throw e;
    }
  }

  async function api(path: string): Promise<any> {
    return withReauth(() => request(`/proxy/protect/api/${path}`));
  }

  return {
    login,

    async getBootstrap(): Promise<any> {
      return api("bootstrap");
    },

    async getCameras(): Promise<any[]> {
      const bootstrap = await api("bootstrap");
      return bootstrap.cameras ?? [];
    },

    async getCamera(id: string): Promise<any> {
      return api(`cameras/${id}`);
    },

    async getNvr(): Promise<any> {
      const bootstrap = await api("bootstrap");
      return bootstrap.nvr ?? null;
    },

    async getLiveviews(): Promise<any[]> {
      const bootstrap = await api("bootstrap");
      return bootstrap.liveviews ?? [];
    },

    async getSensors(): Promise<any[]> {
      const bootstrap = await api("bootstrap");
      return bootstrap.sensors ?? [];
    },

    async getLights(): Promise<any[]> {
      const bootstrap = await api("bootstrap");
      return bootstrap.lights ?? [];
    },

    async getEvents(params?: { start?: number; end?: number; types?: string[] }): Promise<any[]> {
      const query = new URLSearchParams();
      if (params?.start) query.set("start", String(params.start));
      if (params?.end) query.set("end", String(params.end));
      if (params?.types) query.set("types", params.types.join(","));
      const qs = query.toString();
      return api(`events${qs ? `?${qs}` : ""}`);
    },
  };
}

export function createProtectClientFromEnv() {
  const host = process.env.UNIFI_HOST;
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;
  const enabled = process.env.UNIFI_PROTECT_ENABLED;

  if (!host || !username || !password) return null;
  if (enabled !== undefined && enabled !== "true") return null;

  return createProtectClient({ host, username, password });
}
