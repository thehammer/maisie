import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/youtube",
];

const TOKEN_FILE = join(import.meta.dir, "../../data/google-tokens.json");

export function createGoogleAuth(config: GoogleAuthConfig) {
  let tokens: GoogleTokens | null = null;

  // Load persisted tokens on startup
  if (existsSync(TOKEN_FILE)) {
    try {
      tokens = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    } catch {
      // ignore corrupt file
    }
  }

  function persistTokens() {
    if (!tokens) return;
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  }

  function getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async function exchangeCode(code: string): Promise<void> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    persistTokens();
  }

  async function refreshAccessToken(): Promise<void> {
    if (!tokens?.refresh_token) {
      throw new Error("No refresh token — re-authorize at /api/google/auth");
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token refresh failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    tokens = {
      access_token: data.access_token,
      refresh_token: tokens.refresh_token, // Google doesn't always return a new one
      expires_at: Date.now() + data.expires_in * 1000,
    };
    persistTokens();
  }

  async function getAccessToken(): Promise<string> {
    if (!tokens) {
      throw new Error("Not authorized — visit /api/google/auth to connect Google account");
    }

    // Refresh if expiring within 5 minutes
    if (Date.now() > tokens.expires_at - 5 * 60 * 1000) {
      await refreshAccessToken();
    }

    return tokens.access_token;
  }

  async function apiRequest(
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<any> {
    const method = options?.method || "GET";
    const token = await getAccessToken();

    const makeRequest = async (t: string) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${t}`,
        ...options?.headers,
      };
      return fetch(url, { method, headers, body: options?.body });
    };

    const res = await makeRequest(token);

    if (res.status === 401) {
      // Token might have been revoked — try refresh once
      await refreshAccessToken();
      const retry = await makeRequest(tokens!.access_token);
      if (!retry.ok) throw new Error(`Google API ${retry.status}: ${await retry.text()}`);
      if (retry.status === 204) return null;
      return retry.json();
    }

    if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    getAuthUrl,
    exchangeCode,
    getAccessToken,
    apiRequest,
    isAuthorized: () => tokens !== null,
  };
}

export type GoogleAuth = ReturnType<typeof createGoogleAuth>;

export function createGoogleAuthFromEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/google/callback";

  if (!clientId || !clientSecret) return null;

  return createGoogleAuth({ clientId, clientSecret, redirectUri });
}
