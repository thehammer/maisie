import { eq } from "drizzle-orm";
import { hdhrChannels } from "../../services/schema";

type Db = ReturnType<typeof import("../../services/db").initDb>;

interface Channel {
  number: string;
  name: string;
  streamName: string;
}

const SYNTHETIC_HDHR_URL = process.env.SYNTHETIC_HDHR_URL || "http://localhost:5004";

export async function pushLineup(db: Db): Promise<{ pushed: number }> {
  const channels = db
    .select()
    .from(hdhrChannels)
    .all()
    .filter((ch) => ch.enabled);

  const lineup: Channel[] = channels.map((ch) => ({
    number: ch.number,
    name: ch.name,
    streamName: ch.streamName,
  }));

  const res = await fetch(`${SYNTHETIC_HDHR_URL}/api/lineup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lineup),
  });

  if (!res.ok) {
    throw new Error(`Failed to push lineup: ${res.status} ${res.statusText}`);
  }

  return { pushed: lineup.length };
}

// Map camera name to go2rtc stream key (must match config/go2rtc.yaml)
function toStreamName(name: string): string {
  return name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
}

export async function autoPopulateChannels(
  db: Db,
  cameras: { id: string; name: string; isConnected: boolean }[],
): Promise<{ added: number }> {
  const existing = db.select().from(hdhrChannels).all();
  if (existing.length > 0) return { added: 0 };

  let channelNum = 90001;
  let added = 0;
  for (const cam of cameras.filter((c) => c.isConnected).sort((a, b) => a.name.localeCompare(b.name))) {
    db.insert(hdhrChannels)
      .values({
        number: String(channelNum),
        name: cam.name,
        streamName: toStreamName(cam.name),
        cameraId: cam.id,
        enabled: 1,
      })
      .onConflictDoNothing()
      .run();
    channelNum++;
    added++;
  }

  return { added };
}
