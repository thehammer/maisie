interface UniFiConfig {
  host: string;
  username: string;
  password: string;
  site: string;
}

interface UniFiClient {
  mac: string;
  ip: string;
  hostname?: string;
  name?: string;
  oui?: string;
  network?: string;
  is_wired: boolean;
  last_seen: number;
  first_seen?: number;
  _uptime_by_uap?: number;
  ap_mac?: string;
  essid?: string;
  sw_mac?: string;
  sw_port?: number;
  blocked?: boolean;
}

interface UniFiDevice {
  mac: string;
  ip: string;
  name: string;
  model: string;
  type: string; // ugw, usw, uap
  version: string;
  state: number;
  uptime: number;
}

interface UniFiHealth {
  subsystem: string;
  status: string;
  num_adopted?: number;
  num_ap?: number;
  num_sta?: number;
  wan_ip?: string;
  gateways?: string[];
}

export function createUniFiClient(config: UniFiConfig) {
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

    // Capture session cookies
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookies = setCookie.map((c) => c.split(";")[0]);
    }

    // Capture CSRF token for write operations
    const csrf = res.headers.get("x-csrf-token");
    if (csrf) {
      csrfToken = csrf;
    }

    if (!res.ok) {
      throw new Error(`UniFi API ${res.status}: ${res.statusText} — ${path}`);
    }

    return res.json();
  }

  // Shared login state — ensures only one login attempt at a time,
  // and enforces a cooldown to avoid UDM rate limiting.
  let loginPromise: Promise<void> | null = null;
  let lastLoginAttempt = 0;
  const LOGIN_COOLDOWN_MS = 30 * 60 * 1000; // 30 min — UDM has aggressive rate limiting

  async function login(): Promise<void> {
    // If a login is already in flight, piggyback on it
    if (loginPromise) return loginPromise;

    // Enforce cooldown between login attempts
    const elapsed = Date.now() - lastLoginAttempt;
    if (lastLoginAttempt > 0 && elapsed < LOGIN_COOLDOWN_MS) {
      throw new Error(`UniFi login cooldown: ${Math.ceil((LOGIN_COOLDOWN_MS - elapsed) / 1000)}s remaining`);
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
        // Successful login — reset cooldown so next one isn't delayed
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
    const fullPath = `/proxy/network/api/s/${config.site}/${path}`;
    return withReauth(() => request(fullPath));
  }

  async function apiPost(path: string, body: Record<string, unknown>): Promise<any> {
    const fullPath = `/proxy/network/api/s/${config.site}/${path}`;
    return withReauth(() => request(fullPath, { method: "POST", body: JSON.stringify(body) }));
  }

  async function apiPut(path: string, body: Record<string, unknown>): Promise<any> {
    const fullPath = `/proxy/network/api/s/${config.site}/${path}`;
    return withReauth(() => request(fullPath, { method: "PUT", body: JSON.stringify(body) }));
  }

  return {
    login,

    async uploadSslCert(certPem: string, keyPem: string): Promise<any> {
      // Try multiple known UDM certificate endpoints
      const endpoints = [
        { path: "/api/system/certificate", method: "PUT" as const },
        { path: "/proxy/protect/api/certificate", method: "PUT" as const },
      ];

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Cookie: cookies.join("; "),
      };
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      for (const ep of endpoints) {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers,
          body: JSON.stringify({ certificate: certPem, privateKey: keyPem }),
        });

        const setCookie = res.headers.getSetCookie?.() ?? [];
        if (setCookie.length > 0) cookies = setCookie.map((c) => c.split(";")[0]);
        const csrf = res.headers.get("x-csrf-token");
        if (csrf) csrfToken = csrf;

        if (res.ok) return res.json();
        if (res.status !== 404) {
          const body = await res.text();
          throw new Error(`UniFi cert upload ${res.status}: ${body}`);
        }
      }

      throw new Error("No working certificate endpoint found on UDM");
    },

    async getActiveClients(): Promise<UniFiClient[]> {
      const res = await api("stat/sta");
      return res.data;
    },

    async getDevices(): Promise<UniFiDevice[]> {
      const res = await api("stat/device");
      return res.data;
    },

    async getHealth(): Promise<UniFiHealth[]> {
      const res = await api("stat/health");
      return res.data;
    },

    async getNetworks(): Promise<any[]> {
      const res = await api("rest/networkconf");
      return res.data;
    },

    async getFirewallRules(): Promise<any[]> {
      const res = await api("rest/firewallrule");
      return res.data;
    },

    async getSysinfo(): Promise<any> {
      const res = await api("stat/sysinfo");
      return res.data;
    },

    async blockClient(mac: string): Promise<void> {
      await apiPost("cmd/stamgr", { cmd: "block-sta", mac });
    },

    async unblockClient(mac: string): Promise<void> {
      await apiPost("cmd/stamgr", { cmd: "unblock-sta", mac });
    },

    // Routing & NAT
    async getRouting(): Promise<any[]> {
      const res = await api("rest/routing");
      return res.data;
    },

    async getPortForwards(): Promise<any[]> {
      const res = await api("rest/portforward");
      return res.data;
    },

    // DPI (Deep Packet Inspection) stats
    async getDpiStats(): Promise<any> {
      const res = await api("stat/dpi");
      return res.data;
    },

    // IPS/IDS settings (via site settings)
    async getSiteSettings(): Promise<any[]> {
      const res = await api("rest/setting");
      return res.data;
    },

    // WLAN groups / WiFi networks
    async getWlanConf(): Promise<any[]> {
      const res = await api("rest/wlanconf");
      return res.data;
    },

    // All known clients (including offline/historical)
    async getAllUsers(): Promise<any[]> {
      const res = await api("rest/user");
      return res.data;
    },

    // Update a site setting by key (e.g., "ips", "dpi")
    async updateSiteSetting(settingId: string, key: string, data: Record<string, unknown>): Promise<any> {
      const res = await apiPut(`rest/setting/${key}/${settingId}`, data);
      return res.data;
    },

    // Country/regulatory info from sysinfo
    async getFullSysinfo(): Promise<any> {
      const res = await api("stat/sysinfo");
      return res.data;
    },
  };
}

export function createUniFiClientFromEnv() {
  const host = process.env.UNIFI_HOST;
  const username = process.env.UNIFI_USERNAME;
  const password = process.env.UNIFI_PASSWORD;

  if (!host || !username || !password) {
    return null;
  }

  return createUniFiClient({
    host,
    username,
    password,
    site: process.env.UNIFI_SITE || "default",
  });
}
