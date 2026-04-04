interface ProtectConfig {
  host: string;
  username: string;
  password: string;
  sessionFile?: string; // path to persist session cookies across restarts
}

interface SessionData {
  cookies: string[];
  csrfToken: string | null;
  savedAt: string;
}

export function createProtectClient(config: ProtectConfig) {
  const baseUrl = `https://${config.host}`;
  let cookies: string[] = [];
  let csrfToken: string | null = null;

  async function saveSession(): Promise<void> {
    if (!config.sessionFile) return;
    try {
      const data: SessionData = { cookies, csrfToken, savedAt: new Date().toISOString() };
      await Bun.write(config.sessionFile, JSON.stringify(data, null, 2));
    } catch { /* non-fatal */ }
  }

  async function loadSession(): Promise<boolean> {
    if (!config.sessionFile) return false;
    try {
      const raw = await Bun.file(config.sessionFile).text();
      const data: SessionData = JSON.parse(raw);
      cookies = data.cookies ?? [];
      csrfToken = data.csrfToken ?? null;
      return cookies.length > 0;
    } catch { return false; }
  }

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

  // Login state — ensures only one login attempt at a time.
  // Rate limiting (backoff) is handled by the caller in index.ts, not here.
  let loginPromise: Promise<void> | null = null;

  async function login(): Promise<void> {
    if (loginPromise) return loginPromise;

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
        await saveSession();
      } finally {
        loginPromise = null;
      }
    })();

    return loginPromise;
  }

  // Try restoring a saved session before attempting a fresh login.
  // Returns true if the session is still valid (skips login entirely).
  async function tryRestoreSession(): Promise<boolean> {
    const loaded = await loadSession();
    if (!loaded) return false;
    try {
      await request("/proxy/protect/api/nvr");
      return true;
    } catch (e: any) {
      if (e.message?.includes("401")) {
        cookies = [];
        csrfToken = null;
      }
      return false;
    }
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
    tryRestoreSession,

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

export function createProtectClientFromEnv(sessionFile?: string) {
  const host = process.env.UNIFI_HOST;
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;
  const enabled = process.env.UNIFI_PROTECT_ENABLED;

  if (!host || !username || !password) return null;
  if (enabled !== undefined && enabled !== "true") return null;

  return createProtectClient({ host, username, password, sessionFile });
}
