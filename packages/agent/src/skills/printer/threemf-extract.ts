/**
 * 3MF extraction for the model viewer.
 * Parses a 3MF file (from a local or NAS path) and extracts meshes
 * as binary STL buffers with their build-item transforms.
 */

import { readFile } from "fs/promises";
import { join } from "path";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Triangle {
  v1: number;
  v2: number;
  v3: number;
}

interface ExtractedPart {
  name: string;
  objectFile: string;
  vertexCount: number;
  faceCount: number;
  /** 3x4 affine transform as 12 floats (row-major: m00 m01 m02 m03 m10 ...) */
  transform: number[];
}

export interface ThreeMfManifest {
  filePath: string;
  parts: ExtractedPart[];
  partCount: number;
}

/** Read all entries from a 3MF zip */
async function read3mfEntries(filePath: string): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  const tmpDir = join("/tmp", `maisie-3mf-view-${Date.now()}`);

  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;
  await Bun.spawn(["unzip", "-o", "-q", filePath, "-d", tmpDir]).exited;

  const findProc = Bun.spawn(["find", ".", "-type", "f"], { cwd: tmpDir, stdout: "pipe" });
  const findOutput = await new Response(findProc.stdout).text();
  await findProc.exited;
  const items = findOutput.trim().split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  for (const item of items) {
    try {
      const content = await readFile(join(tmpDir, item));
      entries.set(item, new Uint8Array(content));
    } catch {
      // skip
    }
  }

  await Bun.spawn(["rm", "-rf", tmpDir]).exited;
  return entries;
}

function parseVerticesAndFaces(xml: string): { vertices: Vec3[]; faces: Triangle[] } | null {
  const vertices: Vec3[] = [];
  const faces: Triangle[] = [];

  const vertexRegex = /<(?:\w+:)?vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
  let m;
  while ((m = vertexRegex.exec(xml)) !== null) {
    vertices.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) });
  }

  const triRegex = /<(?:\w+:)?triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;
  while ((m = triRegex.exec(xml)) !== null) {
    faces.push({ v1: parseInt(m[1]), v2: parseInt(m[2]), v3: parseInt(m[3]) });
  }

  if (vertices.length === 0 || faces.length === 0) return null;
  return { vertices, faces };
}

/** Convert mesh data to a binary STL buffer */
function meshToSTLBuffer(vertices: Vec3[], faces: Triangle[]): Uint8Array {
  const numFaces = faces.length;
  const bufferSize = 80 + 4 + numFaces * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // 80-byte header (zeros)
  view.setUint32(80, numFaces, true);

  let offset = 84;
  for (const f of faces) {
    const v0 = vertices[f.v1];
    const v1 = vertices[f.v2];
    const v2 = vertices[f.v3];
    if (!v0 || !v1 || !v2) continue;

    // Normal (compute from cross product)
    const e1x = v1.x - v0.x, e1y = v1.y - v0.y, e1z = v1.z - v0.z;
    const e2x = v2.x - v0.x, e2y = v2.y - v0.y, e2z = v2.z - v0.z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    for (const v of [v0, v1, v2]) {
      view.setFloat32(offset, v.x, true); offset += 4;
      view.setFloat32(offset, v.y, true); offset += 4;
      view.setFloat32(offset, v.z, true); offset += 4;
    }

    view.setUint16(offset, 0, true); offset += 2;
  }

  return new Uint8Array(buffer);
}

/** Parse the model_settings.config for part names */
function extractPartNames(settingsXml: string): Map<string, string> {
  const names = new Map<string, string>();
  const objectRegex = /<object\s+id="(\d+)">([\s\S]*?)<\/object>/g;
  let match;
  while ((match = objectRegex.exec(settingsXml)) !== null) {
    const body = match[2];
    const nameMatch = body.match(/<metadata\s+key="name"\s+value="([^"]+)"/);
    const partMatch = body.match(/<part\s+id="(\d+)"/);
    if (nameMatch && partMatch) {
      names.set(partMatch[1], nameMatch[1]);
    }
  }
  return names;
}

/** Parse build-item transforms from root 3dmodel.model */
function parseBuildItems(rootModelXml: string): Map<number, { objectId: number; transform: number[] }> {
  const items = new Map<number, { objectId: number; transform: number[] }>();
  const itemRegex = /<item\s+objectid="(\d+)"[^>]*?(?:transform="([^"]*)")?[^>]*?\/>/g;
  let m;
  let idx = 0;
  while ((m = itemRegex.exec(rootModelXml)) !== null) {
    const objectId = parseInt(m[1]);
    const transformStr = m[2] || "1 0 0 0 1 0 0 0 1 0 0 0";
    const transform = transformStr.split(/\s+/).map(Number);
    items.set(idx++, { objectId, transform });
  }
  return items;
}

/** Parse component references from root model to resolve objectId → model file */
function parseComponents(rootModelXml: string): Map<number, { path: string; transform: number[] }[]> {
  const objects = new Map<number, { path: string; transform: number[] }[]>();
  const objectRegex = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objectRegex.exec(rootModelXml)) !== null) {
    const id = parseInt(m[1]);
    const body = m[2];
    const components: { path: string; transform: number[] }[] = [];
    const compRegex = /p:path="([^"]+)"[^>]*?(?:transform="([^"]*)")?[^>]*?\/>/g;
    let cm;
    while ((cm = compRegex.exec(body)) !== null) {
      const path = cm[1].replace(/^\//, "");
      const transformStr = cm[2] || "1 0 0 0 1 0 0 0 1 0 0 0";
      const transform = transformStr.split(/\s+/).map(Number);
      components.push({ path, transform });
    }
    if (components.length > 0) objects.set(id, components);
  }
  return objects;
}

/**
 * Extract all parts from a 3MF file.
 * Returns a manifest of parts with their transforms, and caches the STL buffers.
 */
export const stlCache = new Map<string, Map<number, Uint8Array>>();

export async function extract3mf(filePath: string, cacheKey?: string): Promise<ThreeMfManifest> {
  const entries = await read3mfEntries(filePath);

  const rootData = entries.get("3D/3dmodel.model");
  if (!rootData) throw new Error("No root 3D model found in 3MF");
  const rootXml = new TextDecoder().decode(rootData);

  const settingsData = entries.get("Metadata/model_settings.config");
  const settingsXml = settingsData ? new TextDecoder().decode(settingsData) : "";
  const partNames = extractPartNames(settingsXml);

  const buildItems = parseBuildItems(rootXml);
  const components = parseComponents(rootXml);

  const parts: ExtractedPart[] = [];
  const stlBuffers = new Map<number, Uint8Array>();

  let partIdx = 0;
  for (const [, item] of buildItems) {
    const comps = components.get(item.objectId);
    if (!comps) continue;

    for (const comp of comps) {
      const modelData = entries.get(comp.path);
      if (!modelData) continue;

      const xml = new TextDecoder().decode(modelData);
      const mesh = parseVerticesAndFaces(xml);
      if (!mesh) continue;

      // Combine component transform with build-item transform
      // For now, use build-item transform (component transform is usually identity
      // or local offset within a multi-part object)
      const idMatch = xml.match(/<(?:\w+:)?object[^>]+id="(\d+)"/);
      const objectId = idMatch?.[1] || "";
      const name = partNames.get(objectId) || comp.path.split("/").pop()?.replace(".model", "") || `part_${partIdx}`;

      const stlBuf = meshToSTLBuffer(mesh.vertices, mesh.faces);
      stlBuffers.set(partIdx, stlBuf);

      parts.push({
        name,
        objectFile: comp.path,
        vertexCount: mesh.vertices.length,
        faceCount: mesh.faces.length,
        transform: item.transform,
      });

      partIdx++;
    }
  }

  const key = cacheKey || filePath;
  stlCache.set(key, stlBuffers);
  // Clear cache after 10 minutes
  setTimeout(() => stlCache.delete(key), 10 * 60 * 1000);

  return { filePath: key, parts, partCount: parts.length };
}

/**
 * Get a cached STL buffer for a specific part index.
 */
export function get3mfPartSTL(filePath: string, partIndex: number): Uint8Array | null {
  return stlCache.get(filePath)?.get(partIndex) ?? null;
}
