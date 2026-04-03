interface HdhrConfig {
  host: string;
}

interface HdhrDevice {
  FriendlyName: string;
  ModelNumber: string;
  FirmwareName: string;
  FirmwareVersion: string;
  DeviceID: string;
  BaseURL: string;
  TunerCount: number;
}

interface HdhrTuner {
  Resource: string;
  VctNumber?: string;
  VctName?: string;
  Frequency?: number;
  SignalStrengthPercent?: number;
  SignalQualityPercent?: number;
  SymbolQualityPercent?: number;
  TargetIP?: string;
  NetworkRate?: number;
}

interface HdhrChannel {
  GuideNumber: string;
  GuideName: string;
  VideoCodec?: string;
  AudioCodec?: string;
  HD?: number;
  DRM?: number;
  URL: string;
}

export function createHdhrClient(config: HdhrConfig) {
  const baseUrl = `http://${config.host}`;

  async function request<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`);
    if (!res.ok) {
      throw new Error(`HDHomeRun ${res.status}: ${res.statusText} — ${path}`);
    }
    return res.json();
  }

  return {
    async getDeviceInfo(): Promise<HdhrDevice> {
      return request("/discover.json");
    },

    async getTunerStatus(): Promise<HdhrTuner[]> {
      return request("/status.json");
    },

    async getLineup(): Promise<HdhrChannel[]> {
      return request("/lineup.json");
    },
  };
}

export interface HdhrStatus {
  name: string;
  model: string;
  firmware: string;
  deviceId: string;
  tuners: {
    id: string;
    active: boolean;
    channel?: string;
    channelName?: string;
    signalStrength?: number;
  }[];
  channelCount: number;
  timestamp: string;
}

export async function getHdhrStatus(
  client: ReturnType<typeof createHdhrClient>,
): Promise<HdhrStatus> {
  const [device, tuners, lineup] = await Promise.all([
    client.getDeviceInfo(),
    client.getTunerStatus(),
    client.getLineup(),
  ]);

  return {
    name: device.FriendlyName,
    model: device.ModelNumber,
    firmware: device.FirmwareVersion,
    deviceId: device.DeviceID,
    tuners: tuners.map((t) => ({
      id: t.Resource,
      active: !!t.VctNumber,
      channel: t.VctNumber,
      channelName: t.VctName,
      signalStrength: t.SignalStrengthPercent,
    })),
    channelCount: lineup.length,
    timestamp: new Date().toISOString(),
  };
}

export function createHdhrClientFromEnv() {
  const host = process.env.HDHR_HOST;
  if (!host) return null;
  return createHdhrClient({ host });
}
