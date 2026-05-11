/**
 * Docker Upgrades — tracks container image digests and optionally pulls updates.
 *
 * Initialise once at agent startup via initDockerUpgrades({ db }).
 * If the Docker socket is unavailable the skill degrades gracefully:
 *   - getDockerUpgradesStatus() always returns a valid (empty) status
 *   - triggerDockerUpgradeCheck() returns { started: false, reason: "Not configured" }
 */

import { eq, desc } from "drizzle-orm";
import { dockerServices, dockerUpgradeHistory } from "../../services/schema";

type Db = ReturnType<typeof import("../../services/db").initDb>;

interface DockerUpgradesConfig {
  db: Db;
  upgradeHour?: number; // 0-23, hour to auto-check; default 4
}

// ── Module-level state ────────────────────────────────────────────────

let config: DockerUpgradesConfig | null = null;
let checking = false;
let checkInterval: ReturnType<typeof setInterval> | null = null;

// ── Public API ────────────────────────────────────────────────────────

export function initDockerUpgrades(cfg: DockerUpgradesConfig) {
  config = cfg;

  // Hourly tick — runs the upgrade check when the clock hits upgradeHour
  checkInterval = setInterval(checkUpgradeHour, 60_000 * 60);

  console.log(
    `  ✓ Docker upgrades initialized (upgrade hour: ${cfg.upgradeHour ?? 4}:00)`,
  );
}

export function stopDockerUpgrades() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

export function getDockerUpgradesStatus() {
  const services = config
    ? config.db.select().from(dockerServices).all()
    : [];

  const recentHistory = config
    ? config.db
        .select()
        .from(dockerUpgradeHistory)
        .orderBy(desc(dockerUpgradeHistory.id))
        .limit(20)
        .all()
    : [];

  return {
    checking,
    upgradeHour: config?.upgradeHour ?? 4,
    services,
    recentHistory,
  };
}

export async function triggerDockerUpgradeCheck(
  service?: string,
): Promise<{ started: boolean; reason?: string }> {
  if (!config) return { started: false, reason: "Not configured" };
  if (checking) return { started: false, reason: "Already checking" };

  checking = true;
  runDockerCheck(service)
    .catch((err) => console.error("[docker-upgrades] Check failed:", err))
    .finally(() => { checking = false; });

  return { started: true };
}

export function setServiceAutoUpdate(
  service: string,
  autoUpdate: boolean,
): { ok: boolean; reason?: string } {
  if (!config) return { ok: false, reason: "Not configured" };

  const existing = config.db
    .select({ service: dockerServices.service })
    .from(dockerServices)
    .where(eq(dockerServices.service, service))
    .get();

  if (!existing) return { ok: false, reason: `Service "${service}" not found` };

  config.db
    .update(dockerServices)
    .set({ autoUpdate })
    .where(eq(dockerServices.service, service))
    .run();

  return { ok: true };
}

// ── Internal ──────────────────────────────────────────────────────────

function checkUpgradeHour() {
  if (!config || checking) return;
  if (new Date().getHours() === (config.upgradeHour ?? 4)) {
    runDockerCheck().catch((err) => {
      console.error("[docker-upgrades] Scheduled check failed:", err);
    });
  }
}

async function runDockerCheck(targetService?: string) {
  if (!config) return;

  const rows = config.db
    .select()
    .from(dockerServices)
    .all()
    .filter((s) => s.enabled && (!targetService || s.service === targetService));

  for (const svc of rows) {
    const now = new Date().toISOString();
    try {
      const latestDigest = await fetchLatestDigest(svc.image);

      if (!latestDigest) {
        config.db
          .insert(dockerUpgradeHistory)
          .values({
            service: svc.service,
            image: svc.image,
            status: "skipped",
            errorMessage: "Could not fetch remote digest",
            checkedAt: now,
          })
          .run();
        config.db
          .update(dockerServices)
          .set({ lastChecked: now })
          .where(eq(dockerServices.service, svc.service))
          .run();
        continue;
      }

      const hasUpdate =
        svc.currentDigest !== null && svc.currentDigest !== latestDigest;

      if (hasUpdate && svc.autoUpdate) {
        const pulled = await pullDockerImage(svc.image);
        if (pulled) {
          config.db
            .update(dockerServices)
            .set({ currentDigest: latestDigest, lastChecked: now, lastUpdated: now })
            .where(eq(dockerServices.service, svc.service))
            .run();
          config.db
            .insert(dockerUpgradeHistory)
            .values({ service: svc.service, image: svc.image, status: "updated", checkedAt: now })
            .run();
        } else {
          config.db
            .update(dockerServices)
            .set({ lastChecked: now })
            .where(eq(dockerServices.service, svc.service))
            .run();
          config.db
            .insert(dockerUpgradeHistory)
            .values({
              service: svc.service,
              image: svc.image,
              status: "failed",
              errorMessage: "docker pull failed",
              checkedAt: now,
            })
            .run();
        }
      } else {
        // No update or auto-update disabled — record the current digest
        config.db
          .update(dockerServices)
          .set({ currentDigest: svc.currentDigest ?? latestDigest, lastChecked: now })
          .where(eq(dockerServices.service, svc.service))
          .run();
        config.db
          .insert(dockerUpgradeHistory)
          .values({
            service: svc.service,
            image: svc.image,
            status: hasUpdate ? "skipped" : "current",
            checkedAt: now,
          })
          .run();
      }
    } catch (err) {
      config.db
        .insert(dockerUpgradeHistory)
        .values({
          service: svc.service,
          image: svc.image,
          status: "failed",
          errorMessage: String(err),
          checkedAt: now,
        })
        .run();
    }
  }
}

/** Fetch the latest manifest digest from Docker Hub (public images only). */
async function fetchLatestDigest(image: string): Promise<string | null> {
  try {
    // Normalise: "nginx" → "library/nginx:latest", "user/image:tag" stays as-is
    let [nameWithTag, tag = "latest"] = image.split(":") as [string, string?];
    if (!nameWithTag.includes("/")) nameWithTag = `library/${nameWithTag}`;

    // 1. Get a Docker Hub token
    const tokenRes = await fetch(
      `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${nameWithTag}:pull`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!tokenRes.ok) return null;
    const { token } = (await tokenRes.json()) as { token: string };

    // 2. HEAD the manifest to get the digest
    const manifestRes = await fetch(
      `https://registry-1.docker.io/v2/${nameWithTag}/manifests/${tag}`,
      {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!manifestRes.ok) return null;
    return manifestRes.headers.get("Docker-Content-Digest");
  } catch {
    return null;
  }
}

async function pullDockerImage(image: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "pull", image], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
