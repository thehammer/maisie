import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { MaisiePlugin } from '@maisie/shared'

export interface PluginRegistryEntry {
  plugin: MaisiePlugin
  source: 'workspace' | 'node_modules'
  packageName: string
}

/**
 * Validates that an unknown value has the required shape of a MaisiePlugin.
 */
export function validatePlugin(plugin: unknown): plugin is MaisiePlugin {
  if (!plugin || typeof plugin !== 'object') return false
  const p = plugin as Record<string, unknown>

  return (
    typeof p.name === 'string' &&
    typeof p.version === 'string' &&
    typeof p.description === 'string' &&
    Array.isArray(p.capabilities) &&
    Array.isArray(p.actions) &&
    Array.isArray(p.events) &&
    typeof p.init === 'function' &&
    typeof p.shutdown === 'function' &&
    typeof p.healthCheck === 'function'
  )
}

/**
 * Attempts to load a plugin from a package directory.
 * Returns null if the package is not a Maisie plugin or fails to load.
 */
async function loadPluginFromDir(
  packageDir: string,
  source: 'workspace' | 'node_modules',
  packageName: string,
): Promise<PluginRegistryEntry | null> {
  const pkgJsonPath = join(packageDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return null

  let pkgJson: Record<string, unknown>
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch {
    return null
  }

  const maisieField = pkgJson.maisie as Record<string, unknown> | undefined
  if (!maisieField || maisieField.plugin !== true) return null

  const mainEntry = (pkgJson.main as string | undefined) ?? 'src/index.ts'
  const entryPath = join(packageDir, mainEntry)

  try {
    const mod = await import(entryPath)
    const plugin = mod.default ?? mod
    if (!validatePlugin(plugin)) {
      console.warn(`[plugin-registry] ${packageName}: loaded but failed validation — skipping`)
      return null
    }
    return { plugin, source, packageName }
  } catch (err) {
    console.warn(`[plugin-registry] ${packageName}: failed to load —`, err)
    return null
  }
}

/**
 * Discovers all Maisie plugins using two strategies:
 *
 * Strategy A — Workspace packages: reads the root package.json workspaces
 *   field and scans each package for `"maisie": { "plugin": true }`.
 *
 * Strategy B — node_modules: scans `node_modules/@maisie/` for packages
 *   with `"maisie": { "plugin": true }`.
 *
 * If a plugin appears in both, the workspace version wins.
 */
export async function discoverPlugins(rootDir: string): Promise<PluginRegistryEntry[]> {
  const results: PluginRegistryEntry[] = []
  const seen = new Set<string>()

  // Strategy A — workspace packages
  const rootPkgPath = join(rootDir, 'package.json')
  if (existsSync(rootPkgPath)) {
    try {
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
      const workspaces: string[] = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []

      for (const pattern of workspaces) {
        // Only handle simple "packages/*" style patterns
        if (!pattern.endsWith('/*')) continue
        const baseDir = join(rootDir, pattern.slice(0, -2))
        if (!existsSync(baseDir)) continue

        const { readdirSync } = await import('fs')
        let entries: string[]
        try {
          entries = readdirSync(baseDir)
        } catch {
          continue
        }

        for (const entry of entries) {
          const pkgDir = join(baseDir, entry)
          const pkgJsonPath = join(pkgDir, 'package.json')
          if (!existsSync(pkgJsonPath)) continue

          let pkgName: string
          try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
            pkgName = pkg.name ?? entry
          } catch {
            continue
          }

          if (seen.has(pkgName)) continue

          const result = await loadPluginFromDir(pkgDir, 'workspace', pkgName)
          if (result) {
            results.push(result)
            seen.add(pkgName)
          }
        }
      }
    } catch (err) {
      console.warn('[plugin-registry] Failed to read root package.json:', err)
    }
  }

  // Strategy B — node_modules/@maisie/
  const maisieModulesDir = join(rootDir, 'node_modules', '@maisie')
  if (existsSync(maisieModulesDir)) {
    const { readdirSync } = await import('fs')
    let entries: string[]
    try {
      entries = readdirSync(maisieModulesDir)
    } catch {
      entries = []
    }

    for (const entry of entries) {
      const pkgName = `@maisie/${entry}`
      if (seen.has(pkgName)) continue // workspace version already loaded

      const pkgDir = join(maisieModulesDir, entry)
      const result = await loadPluginFromDir(pkgDir, 'node_modules', pkgName)
      if (result) {
        results.push(result)
        seen.add(pkgName)
      }
    }
  }

  return results
}
