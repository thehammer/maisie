/**
 * 3MF Mesh Repair — analyzes and repairs STL meshes inside .3mf files.
 *
 * Analysis: pure TypeScript (fast, no deps).
 * Repair: delegates to Python pymeshfix via subprocess for robust results.
 *
 * Handles: non-manifold edges, boundary edges (holes), inconsistent winding,
 * duplicate faces, degenerate triangles.
 */

import { readFile, writeFile } from "fs/promises";
import { join, basename } from "path";

// ── Types ────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Triangle {
  v1: number;
  v2: number;
  v3: number;
}

export interface MeshData {
  vertices: Vec3[];
  faces: Triangle[];
}

export interface MeshDiagnostic {
  objectName: string;
  objectFile: string;
  vertexCount: number;
  faceCount: number;
  isWatertight: boolean;
  isWindingConsistent: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  duplicateFaces: number;
  degenerateFaces: number;
  totalIssues: number;
}

export interface RepairResult {
  objectName: string;
  objectFile: string;
  before: MeshDiagnostic;
  after: MeshDiagnostic;
  repaired: boolean;
  verticesRemoved: number;
  facesRemoved: number;
  facesAdded: number;
}

export interface ThreeMfAnalysis {
  filePath: string;
  objectCount: number;
  objects: MeshDiagnostic[];
  issueCount: number;
  objectsWithIssues: number;
}

export interface ThreeMfRepairResult {
  filePath: string;
  outputPath: string;
  repairs: RepairResult[];
  totalFixed: number;
  totalRemaining: number;
}

// ── Edge helpers ─────────────────────────────────────────────────────

type EdgeKey = string;

function edgeKey(a: number, b: number): EdgeKey {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function faceKey(f: Triangle): string {
  const sorted = [f.v1, f.v2, f.v3].sort((a, b) => a - b);
  return `${sorted[0]}:${sorted[1]}:${sorted[2]}`;
}

function buildEdgeMap(faces: Triangle[]): Map<EdgeKey, number[]> {
  const map = new Map<EdgeKey, number[]>();
  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    for (const e of [edgeKey(f.v1, f.v2), edgeKey(f.v2, f.v3), edgeKey(f.v3, f.v1)]) {
      const list = map.get(e);
      if (list) list.push(fi);
      else map.set(e, [fi]);
    }
  }
  return map;
}

// ── 3MF XML parsing ─────────────────────────────────────────────────

interface ThreeMfObject {
  name: string;
  file: string;
  objectId: string;
  partId: string;
}

function extractObjectList(modelSettingsXml: string): ThreeMfObject[] {
  const objects: ThreeMfObject[] = [];
  const objectRegex = /<object\s+id="(\d+)">([\s\S]*?)<\/object>/g;
  let match;

  while ((match = objectRegex.exec(modelSettingsXml)) !== null) {
    const id = match[1];
    const body = match[2];
    const nameMatch = body.match(/<metadata\s+key="name"\s+value="([^"]+)"/);
    const partMatch = body.match(/<part\s+id="(\d+)"/);
    const sourceMatch = body.match(/<metadata\s+key="source_file"\s+value="([^"]+)"/);

    if (nameMatch && partMatch) {
      objects.push({
        name: nameMatch[1],
        file: sourceMatch?.[1] || nameMatch[1],
        objectId: id,
        partId: partMatch[1],
      });
    }
  }
  return objects;
}

function parseMeshFromModelXml(xml: string): MeshData | null {
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

function meshToModelXml(mesh: MeshData, originalXml: string): string {
  const vertLines = mesh.vertices.map(
    (v) => `     <vertex x="${v.x}" y="${v.y}" z="${v.z}" />`,
  );
  const triLines = mesh.faces.map(
    (f) => `     <triangle v1="${f.v1}" v2="${f.v2}" v3="${f.v3}" />`,
  );

  const meshRegex = /(<(?:\w+:)?mesh>)([\s\S]*?)(<\/(?:\w+:)?mesh>)/;
  const meshMatch = originalXml.match(meshRegex);
  if (!meshMatch) return originalXml;

  const newMesh = `${meshMatch[1]}
    <vertices>
${vertLines.join("\n")}
    </vertices>
    <triangles>
${triLines.join("\n")}
    </triangles>
  ${meshMatch[3]}`;

  return originalXml.replace(meshRegex, newMesh);
}

// ── Mesh analysis (pure TypeScript) ──────────────────────────────────

function isDegenerate(f: Triangle, verts: Vec3[]): boolean {
  if (f.v1 === f.v2 || f.v2 === f.v3 || f.v1 === f.v3) return true;

  const a = verts[f.v1], b = verts[f.v2], c = verts[f.v3];
  if (!a || !b || !c) return true;

  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return (cx * cx + cy * cy + cz * cz) < 1e-20;
}

function checkWindingConsistency(faces: Triangle[]): boolean {
  const edgeDirections = new Map<EdgeKey, { forward: number; backward: number }>();

  for (const f of faces) {
    for (const [a, b] of [[f.v1, f.v2], [f.v2, f.v3], [f.v3, f.v1]] as [number, number][]) {
      const key = edgeKey(a, b);
      let entry = edgeDirections.get(key);
      if (!entry) {
        entry = { forward: 0, backward: 0 };
        edgeDirections.set(key, entry);
      }
      if (a < b) entry.forward++;
      else entry.backward++;
    }
  }

  for (const [, entry] of edgeDirections) {
    const total = entry.forward + entry.backward;
    if (total === 2 && (entry.forward !== 1 || entry.backward !== 1)) {
      return false;
    }
  }
  return true;
}

export function analyzeMesh(mesh: MeshData, name: string, file: string): MeshDiagnostic {
  const edgeMap = buildEdgeMap(mesh.faces);

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const [, faceIndices] of edgeMap) {
    if (faceIndices.length === 1) boundaryEdges++;
    else if (faceIndices.length > 2) nonManifoldEdges++;
  }

  const seen = new Set<string>();
  let duplicateFaces = 0;
  for (const f of mesh.faces) {
    const key = faceKey(f);
    if (seen.has(key)) duplicateFaces++;
    else seen.add(key);
  }

  let degenerateFaces = 0;
  for (const f of mesh.faces) {
    if (isDegenerate(f, mesh.vertices)) degenerateFaces++;
  }

  const isWindingConsistent = checkWindingConsistency(mesh.faces);
  const isWatertight = boundaryEdges === 0 && nonManifoldEdges === 0;

  return {
    objectName: name,
    objectFile: file,
    vertexCount: mesh.vertices.length,
    faceCount: mesh.faces.length,
    isWatertight,
    isWindingConsistent,
    boundaryEdges,
    nonManifoldEdges,
    duplicateFaces,
    degenerateFaces,
    totalIssues: boundaryEdges + nonManifoldEdges + duplicateFaces + degenerateFaces,
  };
}

// ── Mesh repair via pymeshfix subprocess ─────────────────────────────

const REPAIR_SCRIPT = `
import sys, json, struct, os
import numpy as np

def read_stl_binary(path):
    with open(path, 'rb') as f:
        f.read(80)  # header
        n = struct.unpack('<I', f.read(4))[0]
        dtype = np.dtype([('normal', '<f4', 3), ('vertices', '<f4', (3, 3)), ('attr', '<u2')])
        data = np.frombuffer(f.read(n * 50), dtype=dtype)
    all_verts = data['vertices'].reshape(-1, 3)
    unique_verts, inverse = np.unique(all_verts, axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    return unique_verts.astype(np.float64), faces.astype(np.int32)

def write_stl_binary(path, vertices, faces):
    with open(path, 'wb') as f:
        f.write(b'\\0' * 80)
        f.write(struct.pack('<I', len(faces)))
        for face in faces:
            v0, v1, v2 = vertices[face[0]], vertices[face[1]], vertices[face[2]]
            e1, e2 = v1 - v0, v2 - v0
            normal = np.cross(e1, e2)
            norm = np.linalg.norm(normal)
            if norm > 0: normal /= norm
            f.write(struct.pack('<3f', *normal))
            f.write(struct.pack('<3f', *v0))
            f.write(struct.pack('<3f', *v1))
            f.write(struct.pack('<3f', *v2))
            f.write(struct.pack('<H', 0))

input_data = json.loads(sys.stdin.read())
vertices = np.array(input_data['vertices'], dtype=np.float64)
faces = np.array(input_data['faces'], dtype=np.int32)

import pymeshfix
mfix = pymeshfix.MeshFix(vertices, faces)
success = mfix.clean()

repaired = mfix.mesh
verts_out = np.array(repaired.points)
faces_vtk = repaired.faces
faces_out = faces_vtk.reshape(-1, 4)[:, 1:].tolist()

result = {
    'success': bool(success),
    'vertices': verts_out.tolist(),
    'faces': faces_out,
    'vertexCount': len(verts_out),
    'faceCount': len(faces_out),
}
print(json.dumps(result))
`;

async function repairMeshViaPython(mesh: MeshData): Promise<MeshData | null> {
  const input = JSON.stringify({
    vertices: mesh.vertices.map((v) => [v.x, v.y, v.z]),
    faces: mesh.faces.map((f) => [f.v1, f.v2, f.v3]),
  });

  const proc = Bun.spawn(["python3", "-c", REPAIR_SCRIPT], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input);
  proc.stdin.end();

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("[mesh-repair] Python repair failed:", stderr);
    return null;
  }

  try {
    const result = JSON.parse(stdout);
    return {
      vertices: result.vertices.map((v: number[]) => ({ x: v[0], y: v[1], z: v[2] })),
      faces: result.faces.map((f: number[]) => ({ v1: f[0], v2: f[1], v3: f[2] })),
    };
  } catch (err) {
    console.error("[mesh-repair] Failed to parse repair output:", err);
    return null;
  }
}

// ── 3MF file operations ──────────────────────────────────────────────

async function read3mfEntries(filePath: string): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  const tmpDir = join("/tmp", `maisie-3mf-${Date.now()}`);

  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;
  await Bun.spawn(["unzip", "-o", "-q", filePath, "-d", tmpDir]).exited;

  // Use find instead of Bun.Glob — Glob skips dotfiles like .rels which are
  // critical for 3MF (the root _rels/.rels tells readers where the model is)
  const findProc = Bun.spawn(["find", ".", "-type", "f"], { cwd: tmpDir, stdout: "pipe" });
  const findOutput = await new Response(findProc.stdout).text();
  await findProc.exited;
  const items = findOutput.trim().split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  for (const item of items) {
    try {
      const content = await readFile(join(tmpDir, item));
      entries.set(item, new Uint8Array(content));
    } catch {
      // Skip any read errors
    }
  }

  await Bun.spawn(["rm", "-rf", tmpDir]).exited;
  return entries;
}

async function write3mfFile(
  entries: Map<string, Uint8Array>,
  outputPath: string,
): Promise<void> {
  const tmpDir = join("/tmp", `maisie-3mf-write-${Date.now()}`);
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

  for (const [name, data] of entries) {
    const fullPath = join(tmpDir, name);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await Bun.spawn(["mkdir", "-p", dir]).exited;
    await writeFile(fullPath, data);
  }

  try { await Bun.spawn(["rm", "-f", outputPath]).exited; } catch {}
  await Bun.spawn(["/bin/bash", "-c", `cd "${tmpDir}" && zip -r -q "${outputPath}" .`]).exited;
  await Bun.spawn(["rm", "-rf", tmpDir]).exited;
}

// ── Shared helpers ───────────────────────────────────────────────────

function getObjectInfo(
  entries: Map<string, Uint8Array>,
): { partMap: Map<string, ThreeMfObject>; settingsXml: string } {
  const settingsData = entries.get("Metadata/model_settings.config");
  const settingsXml = settingsData ? new TextDecoder().decode(settingsData) : "";
  const objectList = extractObjectList(settingsXml);
  const partMap = new Map<string, ThreeMfObject>();
  for (const obj of objectList) {
    partMap.set(obj.partId, obj);
  }
  return { partMap, settingsXml };
}

function resolveObjectName(
  xml: string,
  entryName: string,
  partMap: Map<string, ThreeMfObject>,
): { name: string; sourceFile: string; objectId: string } {
  const idMatch = xml.match(/<(?:\w+:)?object[^>]+id="(\d+)"/);
  const objectId = idMatch?.[1] || "";
  const objInfo = partMap.get(objectId);
  return {
    name: objInfo?.name || basename(entryName, ".model"),
    sourceFile: objInfo?.file || entryName,
    objectId,
  };
}

/**
 * Gentle repair: remove duplicate and degenerate faces only.
 * Preserves all geometry including non-manifold regions (multi-shell objects).
 */
function gentleRepair(mesh: MeshData): MeshData {
  const seen = new Set<string>();
  const cleanFaces: Triangle[] = [];

  for (const f of mesh.faces) {
    // Skip degenerate
    if (f.v1 === f.v2 || f.v2 === f.v3 || f.v1 === f.v3) continue;
    if (isDegenerate(f, mesh.vertices)) continue;

    // Skip duplicates
    const sorted = [f.v1, f.v2, f.v3].sort((a, b) => a - b);
    const key = `${sorted[0]}:${sorted[1]}:${sorted[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);

    cleanFaces.push(f);
  }

  return { vertices: mesh.vertices, faces: cleanFaces };
}

/**
 * Count connected components separated by non-manifold edges.
 * Many components = overlapping shells that need boolean union.
 */
function countManifoldComponents(faces: Triangle[]): number {
  const edgeMap = buildEdgeMap(faces);
  const visited = new Set<number>();
  let components = 0;

  for (let fi = 0; fi < faces.length; fi++) {
    if (visited.has(fi)) continue;
    components++;
    const stack = [fi];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const f = faces[cur];
      for (const e of [edgeKey(f.v1, f.v2), edgeKey(f.v2, f.v3), edgeKey(f.v3, f.v1)]) {
        const neighbors = edgeMap.get(e);
        if (neighbors && neighbors.length === 2) {
          for (const nfi of neighbors) {
            if (!visited.has(nfi)) stack.push(nfi);
          }
        }
      }
    }
  }
  return components;
}

/** Path to the Blender smart repair script */
const BLENDER_SCRIPT = join(import.meta.dir, "../../../../../scripts/blender-smart-repair.py");
const BLENDER_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";

/**
 * Repair via Blender headless with strategy auto-detection.
 * Returns the repaired mesh, or null if Blender is unavailable.
 */
async function repairMeshViaBlender(
  mesh: MeshData,
  strategy: "auto" | "gentle" | "fill" | "boolean" = "auto",
): Promise<{ mesh: MeshData; strategy: string } | null> {
  const { existsSync } = await import("fs");
  if (!existsSync(BLENDER_PATH) || !existsSync(BLENDER_SCRIPT)) return null;

  // Write mesh as temporary STL
  const tmpIn = `/tmp/maisie-blender-in-${Date.now()}.stl`;
  const tmpOut = `/tmp/maisie-blender-out-${Date.now()}.stl`;

  const stlBuf = meshToSTLBuffer(mesh);
  await writeFile(tmpIn, stlBuf);

  const proc = Bun.spawn(
    [BLENDER_PATH, "--background", "--python", BLENDER_SCRIPT, "--", tmpIn, tmpOut, strategy],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  // Clean up input
  try { await Bun.spawn(["rm", "-f", tmpIn]).exited; } catch {}

  if (exitCode !== 0) {
    try { await Bun.spawn(["rm", "-f", tmpOut]).exited; } catch {}
    return null;
  }

  // Parse the strategy used
  const strategyMatch = stdout.match(/STRATEGY:(\w+)/);
  const usedStrategy = strategyMatch?.[1] || strategy;

  // Read repaired STL
  try {
    const repaired = await readSTLFile(tmpOut);
    await Bun.spawn(["rm", "-f", tmpOut]).exited;
    return { mesh: repaired, strategy: usedStrategy };
  } catch {
    try { await Bun.spawn(["rm", "-f", tmpOut]).exited; } catch {}
    return null;
  }
}

/** Convert mesh to binary STL buffer */
function meshToSTLBuffer(mesh: MeshData): Uint8Array {
  const numFaces = mesh.faces.length;
  const bufSize = 80 + 4 + numFaces * 50;
  const buffer = new ArrayBuffer(bufSize);
  const view = new DataView(buffer);
  view.setUint32(80, numFaces, true);
  let offset = 84;
  for (const f of mesh.faces) {
    const v0 = mesh.vertices[f.v1], v1 = mesh.vertices[f.v2], v2 = mesh.vertices[f.v3];
    if (!v0 || !v1 || !v2) { offset += 50; continue; }
    const e1x = v1.x-v0.x, e1y = v1.y-v0.y, e1z = v1.z-v0.z;
    const e2x = v2.x-v0.x, e2y = v2.y-v0.y, e2z = v2.z-v0.z;
    let nx = e1y*e2z-e1z*e2y, ny = e1z*e2x-e1x*e2z, nz = e1x*e2y-e1y*e2x;
    const len = Math.sqrt(nx*nx+ny*ny+nz*nz);
    if (len > 0) { nx/=len; ny/=len; nz/=len; }
    view.setFloat32(offset, nx, true); offset+=4;
    view.setFloat32(offset, ny, true); offset+=4;
    view.setFloat32(offset, nz, true); offset+=4;
    for (const v of [v0, v1, v2]) {
      view.setFloat32(offset, v.x, true); offset+=4;
      view.setFloat32(offset, v.y, true); offset+=4;
      view.setFloat32(offset, v.z, true); offset+=4;
    }
    view.setUint16(offset, 0, true); offset+=2;
  }
  return new Uint8Array(buffer);
}

/** Read a binary STL file into MeshData */
async function readSTLFile(path: string): Promise<MeshData> {
  const buf = await readFile(path);
  const view = new DataView(buf.buffer);
  const numFaces = view.getUint32(80, true);
  const vertMap = new Map<string, number>();
  const vertices: Vec3[] = [];
  const faces: Triangle[] = [];
  let off = 84;
  for (let i = 0; i < numFaces; i++) {
    off += 12; // skip normal
    const tri: number[] = [];
    for (let j = 0; j < 3; j++) {
      const x = view.getFloat32(off, true); off += 4;
      const y = view.getFloat32(off, true); off += 4;
      const z = view.getFloat32(off, true); off += 4;
      const key = `${x},${y},${z}`;
      if (!vertMap.has(key)) { vertMap.set(key, vertices.length); vertices.push({ x, y, z }); }
      tri.push(vertMap.get(key)!);
    }
    faces.push({ v1: tri[0], v2: tri[1], v3: tri[2] });
    off += 2;
  }
  return { vertices, faces };
}

async function repairEntry(
  entryName: string,
  xml: string,
  mesh: MeshData,
  name: string,
  sourceFile: string,
): Promise<{ repair: RepairResult; newXml: string } | null> {
  const before = analyzeMesh(mesh, name, sourceFile);
  before.objectFile = entryName;

  if (before.totalIssues === 0) return null;

  console.log(`[mesh-repair] Repairing ${name} (${before.totalIssues} issues)...`);

  // Step 1: Try gentle repair (remove duplicates + degenerates)
  const gentle = gentleRepair(mesh);
  const gentleAnalysis = analyzeMesh(gentle, name, sourceFile);

  let repaired: MeshData;
  let method: string;

  if (gentleAnalysis.totalIssues === 0) {
    repaired = gentle;
    method = "gentle";
  } else {
    // Step 2: Determine strategy based on mesh structure
    const components = countManifoldComponents(mesh.faces);
    const needsBoolean = before.nonManifoldEdges > 0 && components > 5;

    // Step 3: Try Blender smart repair
    const blenderStrategy = needsBoolean ? "boolean" : "fill";
    const blenderResult = await repairMeshViaBlender(mesh, blenderStrategy);

    if (blenderResult && blenderResult.mesh.faces.length > mesh.faces.length * 0.5) {
      if (needsBoolean) {
        // For multi-shell parts, always use boolean result — it resolves
        // slicer ambiguity even if our issue count goes up
        repaired = blenderResult.mesh;
        method = `blender:${blenderResult.strategy}`;
      } else {
        const blenderAnalysis = analyzeMesh(blenderResult.mesh, name, sourceFile);
        if (blenderAnalysis.totalIssues < before.totalIssues) {
          repaired = blenderResult.mesh;
          method = `blender:${blenderResult.strategy}`;
        } else {
          const pymeshResult = await repairMeshViaPython(mesh);
          if (pymeshResult && pymeshResult.faces.length > mesh.faces.length * 0.5) {
            repaired = pymeshResult;
            method = "pymeshfix";
          } else {
            repaired = gentle;
            method = "gentle (fallback)";
          }
        }
      }
    } else {
      // Blender unavailable or too destructive, try pymeshfix
      const pymeshResult = await repairMeshViaPython(mesh);
      if (pymeshResult && pymeshResult.faces.length > mesh.faces.length * 0.5) {
        repaired = pymeshResult;
        method = "pymeshfix";
      } else {
        repaired = gentle;
        method = "gentle (fallback)";
      }
    }
  }

  const after = analyzeMesh(repaired, name, sourceFile);
  after.objectFile = entryName;

  const newXml = meshToModelXml(repaired, xml);

  console.log(
    `[mesh-repair] ${name}: ${before.totalIssues} → ${after.totalIssues} issues` +
    ` [${method}] (faces: ${before.faceCount} → ${after.faceCount})`,
  );

  return {
    repair: {
      objectName: name,
      objectFile: entryName,
      before,
      after,
      repaired: after.totalIssues < before.totalIssues,
      verticesRemoved: Math.max(0, before.vertexCount - after.vertexCount),
      facesRemoved: Math.max(0, before.faceCount - after.faceCount),
      facesAdded: Math.max(0, after.faceCount - before.faceCount),
    },
    newXml,
  };
}

// ── Public API ───────────────────────────────────────────────────────

export async function analyze3mf(filePath: string): Promise<ThreeMfAnalysis> {
  const entries = await read3mfEntries(filePath);
  const { partMap } = getObjectInfo(entries);
  const diagnostics: MeshDiagnostic[] = [];

  for (const [entryName, data] of entries) {
    if (!entryName.startsWith("3D/Objects/") || !entryName.endsWith(".model")) continue;

    const xml = new TextDecoder().decode(data);
    const mesh = parseMeshFromModelXml(xml);
    if (!mesh || mesh.faces.length === 0) continue;

    const { name, sourceFile } = resolveObjectName(xml, entryName, partMap);
    const diagnostic = analyzeMesh(mesh, name, sourceFile);
    diagnostic.objectFile = entryName;
    diagnostics.push(diagnostic);
  }

  return {
    filePath,
    objectCount: diagnostics.length,
    objects: diagnostics,
    issueCount: diagnostics.reduce((sum, d) => sum + d.totalIssues, 0),
    objectsWithIssues: diagnostics.filter((d) => d.totalIssues > 0).length,
  };
}

const REPAIR_ARCHIVE = "/Volumes/Shared/3D Printing/_Repair Archive";

/**
 * Archive the original file before repair.
 * Preserves directory structure relative to the 3D Printing root.
 */
async function archiveOriginal(filePath: string): Promise<string | null> {
  const { existsSync, mkdirSync, copyFileSync } = await import("fs");
  const printingRoot = "/Volumes/Shared/3D Printing/";
  if (!filePath.startsWith(printingRoot)) return null;
  if (!existsSync(REPAIR_ARCHIVE)) return null;

  const relative = filePath.slice(printingRoot.length);
  const archivePath = join(REPAIR_ARCHIVE, relative);
  const archiveDir = archivePath.substring(0, archivePath.lastIndexOf("/"));

  // Don't overwrite existing archive (keep the earliest original)
  if (existsSync(archivePath)) return archivePath;

  try {
    mkdirSync(archiveDir, { recursive: true });
    copyFileSync(filePath, archivePath);
    console.log(`[mesh-repair] Archived original → ${relative}`);
    return archivePath;
  } catch (err) {
    console.error(`[mesh-repair] Failed to archive: ${err}`);
    return null;
  }
}

export async function repair3mf(
  filePath: string,
  outputPath?: string,
): Promise<ThreeMfRepairResult> {
  const out = outputPath || filePath.replace(/\.3mf$/, "_repaired.3mf");

  // Archive original before repair
  await archiveOriginal(filePath);
  const entries = await read3mfEntries(filePath);
  const { partMap } = getObjectInfo(entries);
  const repairs: RepairResult[] = [];

  for (const [entryName, data] of entries) {
    if (!entryName.startsWith("3D/Objects/") || !entryName.endsWith(".model")) continue;

    const xml = new TextDecoder().decode(data);
    const mesh = parseMeshFromModelXml(xml);
    if (!mesh || mesh.faces.length === 0) continue;

    const { name, sourceFile } = resolveObjectName(xml, entryName, partMap);
    const result = await repairEntry(entryName, xml, mesh, name, sourceFile);
    if (!result) continue;

    entries.set(entryName, new TextEncoder().encode(result.newXml));
    repairs.push(result.repair);
  }

  await write3mfFile(entries, out);

  return {
    filePath,
    outputPath: out,
    repairs,
    totalFixed: repairs.filter((r) => r.repaired).length,
    totalRemaining: repairs.reduce((sum, r) => sum + r.after.totalIssues, 0),
  };
}

export async function repairSingleObject(
  filePath: string,
  objectName: string,
  outputPath?: string,
): Promise<ThreeMfRepairResult> {
  const out = outputPath || filePath.replace(/\.3mf$/, "_repaired.3mf");
  const entries = await read3mfEntries(filePath);
  const { partMap } = getObjectInfo(entries);
  const repairs: RepairResult[] = [];
  const nameLower = objectName.toLowerCase();

  for (const [entryName, data] of entries) {
    if (!entryName.startsWith("3D/Objects/") || !entryName.endsWith(".model")) continue;

    const xml = new TextDecoder().decode(data);
    const mesh = parseMeshFromModelXml(xml);
    if (!mesh || mesh.faces.length === 0) continue;

    const { name, sourceFile } = resolveObjectName(xml, entryName, partMap);
    if (!name.toLowerCase().includes(nameLower)) continue;

    const result = await repairEntry(entryName, xml, mesh, name, sourceFile);
    if (!result) continue;

    entries.set(entryName, new TextEncoder().encode(result.newXml));
    repairs.push(result.repair);
  }

  await write3mfFile(entries, out);

  return {
    filePath,
    outputPath: out,
    repairs,
    totalFixed: repairs.filter((r) => r.repaired).length,
    totalRemaining: repairs.reduce((sum, r) => sum + r.after.totalIssues, 0),
  };
}
