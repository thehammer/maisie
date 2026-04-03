/** Synology reverse proxy protocol values */
export const ReverseProxyProtocol = {
  HTTP: 0,
  HTTPS: 1,
} as const;

interface DsmConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  https: boolean;
}

export function createDsmClient(config: DsmConfig) {
  const protocol = config.https ? "https" : "http";
  const baseUrl = `${protocol}://${config.host}:${config.port}/webapi`;
  let sid: string | null = null;

  async function request(
    cgi: string,
    api: string,
    method: string,
    version: number,
    params: Record<string, string> = {},
  ): Promise<any> {
    const query = new URLSearchParams({
      api,
      method,
      version: String(version),
      ...params,
      ...(sid ? { _sid: sid } : {}),
    });

    const res = await fetch(`${baseUrl}/${cgi}?${query}`);
    if (!res.ok) {
      throw new Error(`DSM API ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    if (!json.success) {
      // Error code 105 = invalid session — re-auth
      if (json.error?.code === 105) {
        sid = null;
        await login();
        return request(cgi, api, method, version, params);
      }
      throw new Error(`DSM API error: ${JSON.stringify(json.error)}`);
    }

    return json.data;
  }

  async function login(): Promise<void> {
    sid = null;
    const data = await request(
      "auth.cgi",
      "SYNO.API.Auth",
      "login",
      6,
      {
        account: config.username,
        passwd: config.password,
        format: "sid",
      },
    );
    sid = data.sid;
  }

  return {
    login,

    async getSystemInfo(): Promise<{
      model: string;
      ram_size: number;
      temperature: number;
      uptime: number;
      version_string: string;
    }> {
      return request("entry.cgi", "SYNO.DSM.Info", "getinfo", 2);
    },

    async getSystemUtilization(): Promise<{
      cpu: { system_load: number; user_load: number };
      memory: { total_real: string; avail_real: string; total_swap: string; avail_swap: string };
    }> {
      return request("entry.cgi", "SYNO.Core.System.Utilization", "get", 1);
    },

    async getStorageInfo(): Promise<{
      volumes: {
        id: string;
        status: string;
        size: { total: string; used: string };
      }[];
      disks: {
        id: string;
        name: string;
        vendor: string;
        model: string;
        temp: number;
        smart_status: string;
        size_total: string;
      }[];
    }> {
      return request("entry.cgi", "SYNO.Storage.CGI.Storage", "load_info", 1);
    },

    async listFiles(folderPath: string): Promise<{
      name: string;
      path: string;
      isdir: boolean;
      additional: { size: number; time: { mtime: number } };
    }[]> {
      const data = await request("entry.cgi", "SYNO.FileStation.List", "list", 2, {
        folder_path: folderPath,
        additional: '["size","time"]',
      });
      return data.files ?? [];
    },

    async uploadFile(folderPath: string, filename: string, content: string | Uint8Array): Promise<void> {
      if (!sid) await login();
      const form = new FormData();
      form.append("api", "SYNO.FileStation.Upload");
      form.append("method", "upload");
      form.append("version", "2");
      form.append("path", folderPath);
      form.append("create_parents", "true");
      form.append("overwrite", "true");
      if (sid) form.append("_sid", sid);
      const blob = typeof content === "string"
        ? new Blob([content], { type: "text/plain" })
        : new Blob([content], { type: "application/octet-stream" });
      form.append("file", blob, filename);
      const res = await fetch(`${baseUrl}/entry.cgi/upload`, { method: "POST", body: form });
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (!json.success) throw new Error(`Upload failed: ${JSON.stringify(json.error)}`);
      } catch (e) {
        if (e instanceof SyntaxError) throw new Error(`Upload failed: unexpected response`);
        throw e;
      }
    },

    async downloadFile(filePath: string): Promise<Response> {
      if (!sid) await login();
      const query = new URLSearchParams({
        api: "SYNO.FileStation.Download",
        method: "download",
        version: "2",
        path: filePath,
        mode: "download",
        ...(sid ? { _sid: sid } : {}),
      });
      return fetch(`${baseUrl}/entry.cgi?${query}`);
    },

    async deleteFiles(paths: string[]): Promise<void> {
      await request("entry.cgi", "SYNO.FileStation.Delete", "delete", 2, {
        path: JSON.stringify(paths),
      });
    },

    async getReverseProxyRules(): Promise<{
      uuid: string;
      description: string;
      frontend: { fqdn: string; port: number; protocol: number };
      backend: { fqdn: string; port: number; protocol: number };
    }[]> {
      const data = await request("entry.cgi", "SYNO.Core.AppPortal.ReverseProxy", "list", 1);
      return data.entries ?? [];
    },

    async createReverseProxyRule(entry: {
      description: string;
      frontend: { fqdn: string; port: number; protocol: number; https?: { hsts: boolean } };
      backend: { fqdn: string; port: number; protocol: number };
    }): Promise<void> {
      const fullEntry = {
        proxy_connect_timeout: 60,
        proxy_read_timeout: 60,
        proxy_send_timeout: 60,
        proxy_http_version: 1,
        proxy_intercept_errors: false,
        customize_headers: [],
        ...entry,
      };
      const query = new URLSearchParams({
        api: "SYNO.Core.AppPortal.ReverseProxy",
        method: "create",
        version: "1",
        entry: JSON.stringify(fullEntry),
        ...(sid ? { _sid: sid } : {}),
      });
      const res = await fetch(`${baseUrl}/entry.cgi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: query.toString(),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(`Failed to create reverse proxy rule: ${JSON.stringify(json.error)}`);
      }
    },

    async updateReverseProxyRule(uuid: string, entry: {
      description: string;
      frontend: { fqdn: string; port: number; protocol: number; https?: { hsts: boolean } };
      backend: { fqdn: string; port: number; protocol: number };
    }): Promise<void> {
      const fullEntry = {
        UUID: uuid,
        proxy_connect_timeout: 60,
        proxy_read_timeout: 60,
        proxy_send_timeout: 60,
        proxy_http_version: 1,
        proxy_intercept_errors: false,
        customize_headers: [],
        ...entry,
      };
      const query = new URLSearchParams({
        api: "SYNO.Core.AppPortal.ReverseProxy",
        method: "set",
        version: "1",
        entry: JSON.stringify(fullEntry),
        ...(sid ? { _sid: sid } : {}),
      });
      await fetch(`${baseUrl}/entry.cgi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: query.toString(),
      });
      // Note: Synology returns error 103 but still applies the update
    },

    async getDockerContainerDetails(name: string): Promise<any> {
      return request("entry.cgi", "SYNO.Docker.Container", "get", 1, { name });
    },

    async startContainer(name: string): Promise<void> {
      await request("entry.cgi", "SYNO.Docker.Container", "start", 1, { name });
    },

    async stopContainer(name: string): Promise<void> {
      await request("entry.cgi", "SYNO.Docker.Container", "stop", 1, { name });
    },

    async getDockerContainers(): Promise<{
      name: string;
      image: string;
      status: string;
      state: string;
      up_time: number;
    }[]> {
      const data = await request("entry.cgi", "SYNO.Docker.Container", "list", 1, {
        limit: "100",
        offset: "0",
      });
      return data.containers ?? [];
    },
  };
}

export function createDsmClientFromEnv() {
  const host = process.env.SYNOLOGY_HOST;
  const username = process.env.SYNOLOGY_USERNAME;
  const password = process.env.SYNOLOGY_PASSWORD;

  if (!host || !username || !password) {
    return null;
  }

  return createDsmClient({
    host,
    port: Number(process.env.SYNOLOGY_PORT) || 5001,
    username,
    password,
    https: process.env.SYNOLOGY_HTTPS !== "false",
  });
}
