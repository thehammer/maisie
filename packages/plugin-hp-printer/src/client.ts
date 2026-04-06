// HP Embedded Web Server (EWS) client.
//
// HP printers expose XML status endpoints at standard paths. No auth required
// on LAN. Works across most HP inkjet and laser models produced after ~2010.
//
// Endpoint reference:
//   /DevMgmt/ConsumableConfigDyn.xml  — ink/toner cartridge levels + states
//   /DevMgmt/ProductStatusDyn.xml     — overall printer status
//   /DevMgmt/ProductUsageDyn.xml      — total page counts

export interface Cartridge {
  name: string                // e.g. "black", "cyan", "magenta", "yellow"
  levelPercent: number | null // null = printer not reporting level
  state: 'ok' | 'low' | 'depleted' | 'missing' | 'unknown'
}

export interface PrinterStatus {
  state: 'ready' | 'printing' | 'error' | 'offline' | 'warning' | 'unknown'
  raw: string
}

export interface PrinterUsage {
  totalPages: number
  colorPages: number | null
  monoPages: number | null
}

export interface HpPrinterClient {
  getSupplyLevels(): Promise<Cartridge[]>
  getStatus(): Promise<PrinterStatus>
  getUsage(): Promise<PrinterUsage>
  ping(): Promise<boolean>
}

// ── XML helpers ────────────────────────────────────────────────────────────

/** Extract all occurrences of a repeating XML block. */
function extractBlocks(xml: string, tag: string): string[] {
  const results: string[] = []
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) results.push(m[1])
  return results
}

/** Extract a single text value from within an XML snippet. */
function extractValue(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`))
  return m ? m[1].trim() : null
}

function parseCartridgeState(raw: string | null): Cartridge['state'] {
  switch (raw?.toLowerCase()) {
    case 'ok': return 'ok'
    case 'low':
    case 'verylow': return 'low'
    case 'depleted':
    case 'empty': return 'depleted'
    case 'missing':
    case 'unknown':
    default: return raw ? 'unknown' : 'missing'
  }
}

function normalizePrinterState(raw: string): PrinterStatus['state'] {
  const lower = raw.toLowerCase()
  if (lower.includes('ready')) return 'ready'
  if (lower.includes('print')) return 'printing'
  if (lower.includes('error') || lower.includes('jam') || lower.includes('fail')) return 'error'
  if (lower.includes('warn') || lower.includes('attention')) return 'warning'
  if (lower.includes('off') || lower.includes('sleep') || lower.includes('power')) return 'offline'
  return 'unknown'
}

// ── Client factory ─────────────────────────────────────────────────────────

export function createHpPrinterClient(host: string): HpPrinterClient {
  const base = `http://${host}`
  const timeout = 8_000

  async function fetchXml(path: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(`${base}${path}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async getSupplyLevels(): Promise<Cartridge[]> {
      const xml = await fetchXml('/DevMgmt/ConsumableConfigDyn.xml')
      const blocks = extractBlocks(xml, 'ConsumableInfo')
        // Some printers use a slightly different tag name
        .concat(extractBlocks(xml, 'Consumable'))

      if (blocks.length === 0) {
        // Fallback: some older models put everything at the root level
        const name = extractValue(xml, 'ConsumableLabelCode')
          ?? extractValue(xml, 'ConsumableColorEnum')
          ?? 'unknown'
        const levelRaw = extractValue(xml, 'ConsumablePercentageLevelRemaining')
        const stateRaw = extractValue(xml, 'ConsumableStateEnum')
        return [{
          name: name.toLowerCase(),
          levelPercent: levelRaw ? parseInt(levelRaw, 10) : null,
          state: parseCartridgeState(stateRaw),
        }]
      }

      return blocks.map((block) => {
        const name = (
          extractValue(block, 'ConsumableLabelCode') ??
          extractValue(block, 'ConsumableColorEnum') ??
          'unknown'
        ).toLowerCase()

        const levelRaw = extractValue(block, 'ConsumablePercentageLevelRemaining')
        const stateRaw = extractValue(block, 'ConsumableStateEnum')

        return {
          name,
          levelPercent: levelRaw ? parseInt(levelRaw, 10) : null,
          state: parseCartridgeState(stateRaw),
        }
      })
    },

    async getStatus(): Promise<PrinterStatus> {
      const xml = await fetchXml('/DevMgmt/ProductStatusDyn.xml')
      const raw = extractValue(xml, 'ProductStatusEnum')
        ?? extractValue(xml, 'StatusCategory')
        ?? 'unknown'
      return { state: normalizePrinterState(raw), raw }
    },

    async getUsage(): Promise<PrinterUsage> {
      const xml = await fetchXml('/DevMgmt/ProductUsageDyn.xml')
      const total = extractValue(xml, 'TotalImpressions')
        ?? extractValue(xml, 'CumulativeImpressions')
      const color = extractValue(xml, 'ColorImpressions')
      const mono = extractValue(xml, 'MonochromeImpressions')
      return {
        totalPages: total ? parseInt(total, 10) : 0,
        colorPages: color ? parseInt(color, 10) : null,
        monoPages: mono ? parseInt(mono, 10) : null,
      }
    },

    async ping(): Promise<boolean> {
      try {
        await fetchXml('/DevMgmt/ProductStatusDyn.xml')
        return true
      } catch {
        return false
      }
    },
  }
}

export function createHpPrinterClientFromEnv(): HpPrinterClient | null {
  const host = process.env.HP_PRINTER_HOST
  if (!host) return null
  return createHpPrinterClient(host)
}

// ── Discovery ──────────────────────────────────────────────────────────────

/** HP OUI prefixes (first 3 bytes of MAC, lowercase colon-separated). */
const HP_OUI_PREFIXES = [
  '00:00:92', '00:01:e6', '00:02:a5', '00:04:ea', '00:08:02',
  '00:0b:cd', '00:0f:20', '00:10:83', '00:10:e3', '00:11:0a',
  '00:12:79', '00:13:21', '00:14:38', '00:15:99', '00:16:35',
  '00:17:08', '00:18:8b', '00:18:fe', '00:19:bb', '00:1a:4b',
  '00:1b:78', '00:1c:c4', '00:1e:0b', '00:1f:29', '00:21:5a',
  '00:22:64', '00:23:7d', '00:24:81', '00:25:b3', '00:26:55',
  '3c:d9:2b', '40:b0:34', '64:51:06', '70:5a:b6', '84:34:97',
  '9c:b6:54', 'a0:d3:c1', 'b4:99:ba', 'c8:d3:ff', 'd8:9d:67',
  'e8:39:35', 'f0:92:1c', 'fc:15:b4',
]

const HP_MANUFACTURER_TERMS = ['hewlett', 'hp inc', ' hp ']

export function looksLikeHp(manufacturer: string | null | undefined, mac: string | null | undefined): boolean {
  if (manufacturer) {
    const lower = manufacturer.toLowerCase()
    if (HP_MANUFACTURER_TERMS.some(t => lower.includes(t))) return true
  }
  if (mac) {
    const prefix = mac.toLowerCase().slice(0, 8)
    if (HP_OUI_PREFIXES.some(p => prefix.startsWith(p))) return true
  }
  return false
}

/** Probe an IP to see if it looks like an HP EWS printer. */
export async function probeForEws(ip: string): Promise<boolean> {
  try {
    const client = createHpPrinterClient(ip)
    return await client.ping()
  } catch {
    return false
  }
}
