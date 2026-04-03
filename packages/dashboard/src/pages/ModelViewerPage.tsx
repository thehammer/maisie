import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const NAS_ROOT = "/Shared/3D Printing";
const API = import.meta.env.VITE_API_URL || "";
const MATERIAL_COLOR = 0x9b9ea0;

/** Tools known to export Z-up */
const Z_UP_TOOLS = ["blender", "netfabb", "stlb atf", "openscad", "solidworks"];
/** Tools known to export Y-up */
const Y_UP_TOOLS = ["mw ", "meshmixer"];

/**
 * Read the 80-byte STL header to detect the source tool.
 * Returns true (Z-up), false (Y-up), or null (unknown — use geometry heuristic).
 */
function detectToolOrientation(buf: ArrayBuffer): boolean | null {
  const header = new TextDecoder("ascii", { fatal: false })
    .decode(new Uint8Array(buf, 0, Math.min(80, buf.byteLength)))
    .toLowerCase();

  for (const tool of Z_UP_TOOLS) {
    if (header.includes(tool)) return true;
  }
  for (const tool of Y_UP_TOOLS) {
    if (header.includes(tool)) return false;
  }
  return null; // unknown tool
}

/**
 * Use the bounding box to guess orientation:
 * If the geometry is taller in Z than Y, it's likely Z-up.
 */
function needsZUpRotation(buf: ArrayBuffer, geometry?: THREE.BufferGeometry): boolean {
  const fromTool = detectToolOrientation(buf);
  if (fromTool !== null) return fromTool;

  // Fallback: check bounding box — if Z extent > Y extent, it's Z-up
  if (geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const yExtent = box.max.y - box.min.y;
    const zExtent = box.max.z - box.min.z;
    return zExtent > yExtent;
  }

  return true; // last resort default
}

interface FileEntry {
  name: string;
  path: string;
  isdir: boolean;
  additional: { size: number; time: { mtime: number } };
}

type FileCategory = "model" | "image" | "text" | "other";

const MODEL_EXTS = /\.(stl|obj|3mf)$/i;
const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const TEXT_EXTS = /\.(txt|md|html?|css|json|xml|log|gcode|cfg|ini|conf)$/i;

function categorize(name: string): FileCategory {
  if (MODEL_EXTS.test(name)) return "model";
  if (IMAGE_EXTS.test(name)) return "image";
  if (TEXT_EXTS.test(name)) return "text";
  return "other";
}

function categoryIcon(cat: FileCategory, name: string): string {
  if (cat === "model") {
    if (/\.3mf$/i.test(name)) return "3mf";
    if (/\.obj$/i.test(name)) return "obj";
    return "stl";
  }
  if (cat === "image") return "img";
  if (cat === "text") return "txt";
  return "file";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Three.js helpers ---

function clearModels(group: THREE.Group) {
  const toRemove = [...group.children];
  for (const c of toRemove) {
    group.remove(c);
    c.traverse((child) => {
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
      if ((child as THREE.Mesh).material) {
        const mat = (child as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat && typeof mat.dispose === "function") mat.dispose();
      }
    });
  }
}

function fitCamera(group: THREE.Group, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const box = new THREE.Box3();
  if (group.children.length > 0) box.expandByObject(group);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  camera.near = size / 100;
  camera.far = size * 100;
  camera.position.set(center.x, center.y + size * 0.5, center.z + size * 1.5);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();

  const grid = scene.children.find((c) => c.userData.isGrid);
  if (grid) {
    const scale = size / 500;
    grid.scale.set(scale, scale, scale);
    grid.position.set(center.x, box.min.y, center.z);
  }
}

function makeMaterial() {
  return new THREE.MeshPhongMaterial({ color: MATERIAL_COLOR, specular: 0x111111, shininess: 5 });
}

// --- Hash routing helpers ---

function getPathFromHash(): string {
  const hash = window.location.hash;
  const prefix = "#model-viewer";
  if (!hash.startsWith(prefix)) return NAS_ROOT;
  const rest = decodeURIComponent(hash.slice(prefix.length));
  if (!rest || rest === "/") return NAS_ROOT;
  return NAS_ROOT + rest;
}

function setHashPath(nasPath: string) {
  const relative = nasPath.startsWith(NAS_ROOT) ? nasPath.slice(NAS_ROOT.length) : "";
  const newHash = `#model-viewer${relative || ""}`;
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, "", newHash);
  }
}

// --- Preview types ---

type PreviewMode = "none" | "model" | "image" | "text" | "gallery";

interface FileConfig {
  rotation?: [number, number, number];
  hidden?: boolean;
}

interface ViewerConfig {
  rotation?: [number, number, number]; // folder-level default rotation
  files?: Record<string, FileConfig>;  // per-file overrides, keyed by filename
}

async function loadViewerConfig(path: string): Promise<ViewerConfig> {
  try {
    const res = await fetch(`${API}/api/nas/viewer-config?path=${encodeURIComponent(path)}`);
    return await res.json();
  } catch {
    return {};
  }
}

async function saveViewerConfig(path: string, config: ViewerConfig) {
  try {
    await fetch(`${API}/api/nas/viewer-config?path=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch {
    // silently fail
  }
}

export function ModelViewerPage({ onBack }: { onBack: () => void }) {
  const [currentPath, setCurrentPath] = useState(() => getPathFromHash());
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("none");
  const [textContent, setTextContent] = useState<string>("");
  const [imageUrls, setImageUrls] = useState<{ name: string; url: string }[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [folderRotation, setFolderRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [viewerConfig, setViewerConfig] = useState<ViewerConfig>({});
  const configRef = useRef<ViewerConfig>({});

  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);
  const loadIdRef = useRef(0);

  /** Update config, save, and optionally reload models */
  const updateConfig = useCallback((updater: (cfg: ViewerConfig) => ViewerConfig, reload = false) => {
    const next = updater(configRef.current);
    configRef.current = next;
    setViewerConfig({ ...next });
    saveViewerConfig(currentPath, next);
    if (reload && modelGroupRef.current) {
      // Trigger model reload by bumping loadId
      loadIdRef.current++;
    }
  }, [currentPath]);

  const toggleFileHidden = useCallback((filename: string) => {
    updateConfig((cfg) => {
      const files = { ...cfg.files };
      const fc = { ...files[filename] };
      fc.hidden = !fc.hidden;
      files[filename] = fc;
      return { ...cfg, files };
    });
    // Reload assembly with updated visibility
    const group = modelGroupRef.current;
    if (group) {
      // Toggle visibility on already-loaded mesh
      const child = group.children.find((c) => c.userData.fileName === filename);
      if (child) {
        child.visible = !child.visible;
      }
    }
  }, [updateConfig]);

  /** Apply per-file rotation to a file's wrapper group */
  const applyFileRotation = useCallback((filename: string, rot: [number, number, number]) => {
    const group = modelGroupRef.current;
    if (!group) return;
    // Each file is wrapped: group > fileWrapper (per-file rot) > mesh (base rot + geometry)
    const wrapper = group.children.find((c) => c.userData.fileName === filename);
    if (wrapper) {
      wrapper.rotation.set(
        (rot[0] * Math.PI) / 180,
        (rot[1] * Math.PI) / 180,
        (rot[2] * Math.PI) / 180,
      );
    }
  }, []);

  const rotateFile = useCallback((filename: string, axis: number) => {
    updateConfig((cfg) => {
      const files = { ...cfg.files };
      const fc = { ...files[filename] };
      const rot: [number, number, number] = fc.rotation ? [...fc.rotation] : [0, 0, 0];
      rot[axis] = (rot[axis] + 90) % 360;
      fc.rotation = rot;
      files[filename] = fc;
      return { ...cfg, files };
    });
    const fileRot = configRef.current.files?.[filename]?.rotation || [0, 0, 0];
    applyFileRotation(filename, fileRot);
  }, [updateConfig, applyFileRotation]);

  const resetFileConfig = useCallback((filename: string) => {
    updateConfig((cfg) => {
      const files = { ...cfg.files };
      delete files[filename];
      return { ...cfg, files };
    });
    applyFileRotation(filename, [0, 0, 0]);
  }, [updateConfig, applyFileRotation]);

  const modelFiles = entries.filter((e) => !e.isdir && MODEL_EXTS.test(e.name));
  const imageFiles = entries.filter((e) => !e.isdir && IMAGE_EXTS.test(e.name));
  const textFiles = entries.filter((e) => !e.isdir && TEXT_EXTS.test(e.name));

  // --- Directory loading ---

  const loadDirectory = useCallback(async (path: string) => {
    setBrowserLoading(true);
    setSelectedFile(null);
    setPreviewMode("none");
    setTextContent("");
    setImageUrls([]);
    setLightboxUrl(null);
    try {
      const res = await fetch(`${API}/api/nas/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const sorted = [...data].sort((a: FileEntry, b: FileEntry) => {
          if (a.isdir !== b.isdir) return a.isdir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
      }
    } catch {
      setEntries([]);
    }
    setBrowserLoading(false);
  }, []);

  useEffect(() => {
    setHashPath(currentPath);
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // --- Three.js init ---

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const w = mount.clientWidth;
    const h = mount.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.setClearColor(0x1a1d27);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000);
    camera.position.set(0, 150, 300);
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 3);
    scene.add(dir);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.3).translateX(-1).translateY(-1).translateZ(-2));

    const grid = new THREE.GridHelper(500, 50, 0x2a2e3a, 0x2a2e3a);
    grid.userData.isGrid = true;
    scene.add(grid);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth;
      const nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  // --- Model loaders ---

  const loadSingleModel = useCallback(async (filePath: string) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const group = modelGroupRef.current;
    if (!scene || !camera || !controls || !group) return;

    loadIdRef.current++;
    clearModels(group);
    setModelLoading(true);
    setPreviewMode("model");
    setLoadProgress("");

    try {
      const cfg = configRef.current;
      const filename = filePath.split("/").pop() || "";

      if (/\.3mf$/i.test(filePath)) {
        await load3mfFile(filePath, group, scene, camera, controls);
      } else {
        const res = await fetch(`${API}/api/nas/download?path=${encodeURIComponent(filePath)}`);
        const buf = await res.arrayBuffer();

        let innerObj: THREE.Object3D;
        if (/\.obj$/i.test(filePath)) {
          const text = new TextDecoder().decode(buf);
          const obj = new OBJLoader().parse(text);
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).material = makeMaterial();
            }
          });
          obj.rotateX(-Math.PI / 2);
          innerObj = obj;
        } else {
          const geometry = new STLLoader().parse(buf);
          if (needsZUpRotation(buf, geometry)) geometry.rotateX(-Math.PI / 2);
          geometry.computeBoundingBox();
          geometry.center();
          geometry.computeVertexNormals();
          innerObj = new THREE.Mesh(geometry, makeMaterial());
        }

        // Center pivot for rotation
        const bbox = new THREE.Box3().setFromObject(innerObj);
        const center = bbox.getCenter(new THREE.Vector3());
        innerObj.position.sub(center);

        const wrapper = new THREE.Group();
        wrapper.position.copy(center);
        wrapper.add(innerObj);
        wrapper.userData.fileName = filename;

        const fileRot = cfg.files?.[filename]?.rotation;
        if (fileRot) {
          wrapper.rotation.set(
            (fileRot[0] * Math.PI) / 180,
            (fileRot[1] * Math.PI) / 180,
            (fileRot[2] * Math.PI) / 180,
          );
        }

        group.add(wrapper);
        fitCamera(group, scene, camera, controls);
      }
    } catch {
      // silently fail
    }
    setModelLoading(false);
  }, []);

  const load3mfFile = async (
    filePath: string,
    group: THREE.Group,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
  ) => {
    const thisLoadId = ++loadIdRef.current;
    setLoadProgress("extracting...");

    const manifestRes = await fetch(`${API}/api/3mf/extract?path=${encodeURIComponent(filePath)}`);
    const manifest = await manifestRes.json();
    if (manifest.error) throw new Error(manifest.error);

    const total = manifest.parts.length;
    let loaded = 0;
    const stlLoader = new STLLoader();

    const BATCH_SIZE = 6;
    for (let i = 0; i < manifest.parts.length; i += BATCH_SIZE) {
      if (loadIdRef.current !== thisLoadId) return;
      const batch = manifest.parts.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (part: any, batchIdx: number) => {
          const partIdx = i + batchIdx;
          try {
            const res = await fetch(
              `${API}/api/3mf/part?path=${encodeURIComponent(filePath)}&index=${partIdx}`,
            );
            const buf = await res.arrayBuffer();
            if (loadIdRef.current !== thisLoadId) return;

            const geometry = stlLoader.parse(buf);
            geometry.rotateX(-Math.PI / 2);
            geometry.computeVertexNormals();

            const mesh = new THREE.Mesh(geometry, makeMaterial());

            // Apply 3MF transform (3x4 row-major → Three.js column-major 4x4)
            const t = part.transform;
            if (t && t.length === 12) {
              const m = new THREE.Matrix4();
              // 3MF stores: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz
              m.set(
                t[0], t[1], t[2], t[9],
                t[3], t[4], t[5], t[10],
                t[6], t[7], t[8], t[11],
                0, 0, 0, 1,
              );
              // Also rotate the transform for Z-up → Y-up
              const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
              mesh.applyMatrix4(rot.multiply(m));
            }

            mesh.userData.fileName = part.name;
            group.add(mesh);
          } catch {
            // skip
          }
          loaded++;
          setLoadProgress(`${loaded} / ${total}`);
        }),
      );
    }

    if (loadIdRef.current === thisLoadId) {
      fitCamera(group, scene, camera, controls);
    }
  };

  const loadAllModels = useCallback(
    async (files: FileEntry[]) => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const group = modelGroupRef.current;
      const cfg = configRef.current;
      if (!scene || !camera || !controls || !group || files.length === 0) return;

      const stlObjFiles = files.filter((f) => /\.(stl|obj)$/i.test(f.name));
      const threemfFiles = files.filter((f) => /\.3mf$/i.test(f.name));

      // If only a single 3MF, load it with transforms
      if (threemfFiles.length === 1 && stlObjFiles.length === 0) {
        setPreviewMode("model");
        setModelLoading(true);
        try {
          clearModels(group);
          await load3mfFile(threemfFiles[0].path, group, scene, camera, controls);
        } catch { /* */ }
        setModelLoading(false);
        return;
      }

      // Filter out hidden files
      const visibleFiles = stlObjFiles.filter((f) => !cfg.files?.[f.name]?.hidden);
      if (visibleFiles.length === 0 && stlObjFiles.length > 0) {
        // All hidden — show empty but set model mode
        clearModels(group);
        setPreviewMode("model");
        return;
      }
      if (visibleFiles.length === 0) return;

      const thisLoadId = ++loadIdRef.current;
      clearModels(group);
      setModelLoading(true);
      setPreviewMode("model");
      setSelectedFile(null);

      const stlLoader = new STLLoader();
      const objLoader = new OBJLoader();
      const total = visibleFiles.length;
      let loaded = 0;

      let rotateZUp: boolean | null = null;

      const BATCH_SIZE = 6;
      for (let i = 0; i < visibleFiles.length; i += BATCH_SIZE) {
        if (loadIdRef.current !== thisLoadId) return;
        const batch = visibleFiles.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (entry) => {
            try {
              const res = await fetch(`${API}/api/nas/download?path=${encodeURIComponent(entry.path)}`);
              const buf = await res.arrayBuffer();
              if (loadIdRef.current !== thisLoadId) return;

              // Inner object has base rotation (Z-up correction)
              let innerObj: THREE.Object3D;
              if (/\.obj$/i.test(entry.name)) {
                const text = new TextDecoder().decode(buf);
                const obj = objLoader.parse(text);
                obj.traverse((child) => {
                  if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = makeMaterial();
                });
                obj.rotateX(-Math.PI / 2);
                innerObj = obj;
              } else {
                const geometry = stlLoader.parse(buf);
                if (rotateZUp === null) rotateZUp = needsZUpRotation(buf, geometry);
                if (rotateZUp) geometry.rotateX(-Math.PI / 2);
                geometry.computeVertexNormals();
                innerObj = new THREE.Mesh(geometry, makeMaterial());
              }

              // Compute the object's center so rotation happens around it
              const bbox = new THREE.Box3().setFromObject(innerObj);
              const center = bbox.getCenter(new THREE.Vector3());

              // Offset inner object so its center is at wrapper's origin
              innerObj.position.sub(center);

              // Wrapper sits at the object's original center
              // — rotation now orbits around the object's own center
              const wrapper = new THREE.Group();
              wrapper.position.copy(center);
              wrapper.add(innerObj);
              wrapper.userData.fileName = entry.name;

              // Apply per-file rotation to wrapper (rotates around object center)
              const fileRot = cfg.files?.[entry.name]?.rotation;
              if (fileRot) {
                wrapper.rotation.set(
                  (fileRot[0] * Math.PI) / 180,
                  (fileRot[1] * Math.PI) / 180,
                  (fileRot[2] * Math.PI) / 180,
                );
              }

              group.add(wrapper);
            } catch { /* skip */ }
            loaded++;
            setLoadProgress(`${loaded} / ${total}`);
          }),
        );
      }

      if (loadIdRef.current === thisLoadId) {
        fitCamera(group, scene, camera, controls);
        setModelLoading(false);
        setLoadProgress("");
      }
    },
    [],
  );

  // --- Apply folder rotation to model group ---

  useEffect(() => {
    const group = modelGroupRef.current;
    if (!group) return;
    const [rx, ry, rz] = folderRotation;
    group.rotation.set(
      (rx * Math.PI) / 180,
      (ry * Math.PI) / 180,
      (rz * Math.PI) / 180,
    );
    // Re-fit camera after rotation
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (scene && camera && controls && group.children.length > 0) {
      fitCamera(group, scene, camera, controls);
    }
  }, [folderRotation]);

  // --- Auto-load on directory change ---

  useEffect(() => {
    if (browserLoading) return;

    // Load viewer config, then load models with config applied
    loadViewerConfig(currentPath).then((config) => {
      configRef.current = config;
      setViewerConfig(config);
      setFolderRotation(config.rotation || [0, 0, 0]);

      // Auto-load models if present
      if (modelFiles.length > 0) {
        loadAllModels(modelFiles);
        return;
      }
    });

    // Show image gallery if images present (no config needed)
    if (imageFiles.length > 0 && modelFiles.length === 0) {
      const urls = imageFiles.map((f) => ({
        name: f.name,
        url: `${API}/api/nas/download?path=${encodeURIComponent(f.path)}`,
      }));
      setImageUrls(urls);
      setPreviewMode("gallery");
      return;
    }

    // Clear viewer
    setPreviewMode("none");
    if (modelGroupRef.current) clearModels(modelGroupRef.current);
  }, [entries, browserLoading, loadAllModels]);

  // --- File click handlers ---

  const handleFileClick = useCallback((entry: FileEntry) => {
    if (entry.isdir) {
      setCurrentPath(entry.path);
      return;
    }

    const cat = categorize(entry.name);
    setSelectedFile(entry.path);

    if (cat === "model") {
      loadIdRef.current++;
      loadSingleModel(entry.path);
    } else if (cat === "image") {
      setPreviewMode("image");
      setLightboxUrl(`${API}/api/nas/download?path=${encodeURIComponent(entry.path)}`);
    } else if (cat === "text") {
      setPreviewMode("text");
      fetch(`${API}/api/nas/download?path=${encodeURIComponent(entry.path)}`)
        .then((r) => r.text())
        .then(setTextContent)
        .catch(() => setTextContent("Failed to load file"));
    }
  }, [loadSingleModel]);

  // --- Render ---

  const breadcrumbs = currentPath.replace(NAS_ROOT, "").split("/").filter(Boolean);
  const showCanvas = previewMode === "model" || previewMode === "none";

  return (
    <div className="mvp-page">
      <div className="bsp-header">
        <button className="bsp-back" onClick={onBack}>&larr; Back</button>
        <h2>3D Model Viewer</h2>
      </div>

      <div className="mvp-layout">
        {/* File Browser */}
        <div className="mvp-sidebar">
          <div className="mvp-breadcrumb">
            <span className="mvp-crumb" onClick={() => setCurrentPath(NAS_ROOT)}>
              3D Printing
            </span>
            {breadcrumbs.map((seg, i) => {
              const path = NAS_ROOT + "/" + breadcrumbs.slice(0, i + 1).join("/");
              return (
                <span key={path}>
                  <span className="mvp-crumb-sep">/</span>
                  <span className="mvp-crumb" onClick={() => setCurrentPath(path)}>
                    {decodeURIComponent(seg)}
                  </span>
                </span>
              );
            })}
          </div>

          {modelLoading && loadProgress && (
            <div className="mvp-load-all">
              <div className="mvp-load-status">Loading {loadProgress}...</div>
            </div>
          )}

          {currentPath !== NAS_ROOT && (
            <div
              className="mvp-file-item"
              onClick={() => {
                const parent = currentPath.substring(0, currentPath.lastIndexOf("/"));
                setCurrentPath(parent || NAS_ROOT);
              }}
            >
              <span className="mvp-file-icon">..</span>
              <span className="mvp-file-name">(up)</span>
            </div>
          )}

          {browserLoading && <div className="mvp-empty-hint">Loading...</div>}

          {entries.map((entry) => {
            const cat = entry.isdir ? "other" : categorize(entry.name);
            const isModel = cat === "model";
            const fileConf = viewerConfig.files?.[entry.name];
            const isHidden = fileConf?.hidden ?? false;
            return (
              <div
                key={entry.path}
                className={`mvp-file-item ${selectedFile === entry.path ? "selected" : ""} ${isHidden ? "mvp-file-hidden" : ""}`}
                onClick={() => handleFileClick(entry)}
              >
                {isModel && previewMode === "model" && (
                  <button
                    className={`mvp-vis-btn ${isHidden ? "hidden" : ""}`}
                    title={isHidden ? "Show in assembly" : "Hide from assembly"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFileHidden(entry.name);
                    }}
                  >
                    {isHidden ? "\u25CB" : "\u25CF"}
                  </button>
                )}
                <span className="mvp-file-icon">
                  {entry.isdir ? "dir" : categoryIcon(cat, entry.name)}
                </span>
                <span className="mvp-file-name">{entry.name}</span>
                {!entry.isdir && (
                  <span className="mvp-file-size">{formatSize(entry.additional.size)}</span>
                )}
              </div>
            );
          })}

          {!browserLoading && entries.length === 0 && (
            <div className="mvp-empty-hint" style={{ position: "relative" }}>
              No files found
            </div>
          )}
        </div>

        {/* Viewer Area */}
        <div className="mvp-viewer">
          {/* Rotation controls */}
          {showCanvas && previewMode === "model" && (() => {
            const selName = selectedFile?.split("/").pop();
            const isFileSelected = selName && MODEL_EXTS.test(selName);
            const target = isFileSelected ? selName : null;
            const curRot = target
              ? (viewerConfig.files?.[target]?.rotation || [0, 0, 0])
              : folderRotation;
            const label = target ? target : "Folder";
            const hasRot = curRot[0] !== 0 || curRot[1] !== 0 || curRot[2] !== 0;

            return (
              <div className="mvp-rotate-bar">
                <span className="mvp-rotate-label">{label}:</span>
                {(["X", "Y", "Z"] as const).map((axis, i) => (
                  <button
                    key={axis}
                    className="mvp-rotate-btn"
                    title={`Rotate ${label} 90° around ${axis}`}
                    onClick={() => {
                      if (target) {
                        rotateFile(target, i);
                      } else {
                        const next: [number, number, number] = [...folderRotation];
                        next[i] = (next[i] + 90) % 360;
                        setFolderRotation(next);
                        updateConfig((cfg) => ({ ...cfg, rotation: next }));
                      }
                    }}
                  >
                    {axis}+90
                  </button>
                ))}
                {hasRot && (
                  <button
                    className="mvp-rotate-btn mvp-rotate-reset"
                    onClick={() => {
                      if (target) {
                        resetFileConfig(target);
                        // Reload to reset the mesh rotation
                        loadAllModels(modelFiles);
                      } else {
                        setFolderRotation([0, 0, 0]);
                        updateConfig((cfg) => ({ ...cfg, rotation: [0, 0, 0] }));
                      }
                    }}
                  >
                    Reset
                  </button>
                )}
                {hasRot && (
                  <span className="mvp-rotate-info">
                    {curRot.map((v, i) => v !== 0 ? `${["X","Y","Z"][i]}:${v}°` : null).filter(Boolean).join(" ")}
                  </span>
                )}
              </div>
            );
          })()}
          {/* 3D Canvas — always mounted, hidden when not in model mode */}
          <div ref={mountRef} className="mvp-canvas" style={{ display: showCanvas ? "block" : "none" }} />

          {previewMode === "none" && !modelLoading && (
            <div className="mvp-empty-hint">Navigate to a folder to preview files</div>
          )}
          {modelLoading && previewMode === "model" && !loadProgress && (
            <div className="mvp-empty-hint">Loading model...</div>
          )}

          {/* Image lightbox */}
          {previewMode === "image" && lightboxUrl && (
            <div className="mvp-image-preview">
              <img src={lightboxUrl} alt="" />
            </div>
          )}

          {/* Text preview */}
          {previewMode === "text" && (
            <div className="mvp-text-preview">
              <pre>{textContent}</pre>
            </div>
          )}

          {/* Image gallery */}
          {previewMode === "gallery" && (
            <div className="mvp-gallery">
              {imageUrls.map((img) => (
                <div
                  key={img.name}
                  className="mvp-gallery-item"
                  onClick={() => {
                    setPreviewMode("image");
                    setLightboxUrl(img.url);
                    setSelectedFile(img.name);
                  }}
                >
                  <img src={img.url} alt={img.name} loading="lazy" />
                  <span className="mvp-gallery-name">{img.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
