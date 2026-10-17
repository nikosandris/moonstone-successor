// Assets of the realistic map: CC0 Poly Haven terrain materials, night HDRI and nature models
// (public/assets/ph, scripts/polyhaven.ts) and CC-BY Sketchfab buildings (public/assets/sf, scripts/sketchfab.ts).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL;
export const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'moss', 'mud'] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];

const PH_MODELS = ['rocks_a', 'rocks_b', 'cliff', 'cliff2', 'deadtree', 'lantern', 'barrel', 'crate', 'firepit', 'fort'] as const;
const SF_MODELS = ['keep', 'keepgate', 'house1', 'house2', 'house3', 'mill', 'ruin_arch', 'ruin_wall', 'stonehenge', 'altar', 'lairgate', 'pine', 'spruce', 'deadpine', 'bush', 'ferns'] as const;
export type MapModel = (typeof PH_MODELS)[number] | (typeof SF_MODELS)[number];

const models = new Map<string, THREE.Object3D>();
const textures = new Map<string, THREE.Texture>();
let env: THREE.DataTexture | null = null;
let loading: Promise<void> | null = null;

/**
 * Make downloaded models behave in a lit night scene: unlit materials become lit, and blended foliage
 * becomes alpha-tested (blending breaks with instancing and depth sorting).
 */
function prepare(scene: THREE.Object3D): THREE.Object3D {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // unlit exports often carry no normals: lighting them needs some
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    const fix = (m: THREE.Material): THREE.Material => {
      let mat = m as THREE.MeshStandardMaterial;
      if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
        const b = m as THREE.MeshBasicMaterial;
        mat = new THREE.MeshStandardMaterial({ map: b.map, color: b.color, roughness: 0.9, metalness: 0, side: b.side, alphaTest: b.alphaTest, transparent: b.transparent });
      }
      if (mat.transparent && mat.map) {
        mat.transparent = false;
        mat.alphaTest = 0.45;
        mat.depthWrite = true;
        mat.side = THREE.DoubleSide;
      }
      return mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fix) : fix(mesh.material);
  });
  return scene;
}

/** Load everything the map needs; `onProgress` gets 0..1. */
export function loadMapAssets(onProgress?: (f: number) => void): Promise<void> {
  if (loading) return loading;
  const gl = new GLTFLoader();
  gl.setMeshoptDecoder(MeshoptDecoder);
  const tl = new THREE.TextureLoader();
  const jobs: (() => Promise<void>)[] = [];
  for (const layer of TERRAIN_LAYERS) {
    for (const kind of ['diff', 'nor'] as const) {
      jobs.push(() => tl.loadAsync(`${BASE}assets/ph/${layer}_${kind}.webp`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        textures.set(`${layer}_${kind}`, t);
      }));
    }
  }
  jobs.push(() => tl.loadAsync(`${BASE}assets/ph/waternormals.webp`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textures.set('water', t);
  }));
  jobs.push(() => new HDRLoader().loadAsync(`${BASE}assets/ph/night.hdr`).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    env = t;
  }));
  const glb = (url: string, name: string) => () => gl.loadAsync(url).then((g: GLTF) => { models.set(name, prepare(g.scene)); });
  for (const m of PH_MODELS) jobs.push(glb(`${BASE}assets/ph/${m}.glb`, m));
  for (const m of SF_MODELS) jobs.push(glb(`${BASE}assets/sf/${m}.glb`, m));
  let done = 0;
  loading = (async () => {
    // a few at a time: fast on good connections without starving the rest of the page
    const queue = [...jobs];
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift()!;
        try { await job(); } catch (e) { console.warn('map asset failed', e); }
        done++;
        onProgress?.(done / jobs.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (!textures.has('grass_diff')) throw new Error('terrain textures missing');
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export function mapTexture(name: string): THREE.Texture | null {
  return textures.get(name) ?? null;
}

export function mapEnv(): THREE.DataTexture | null {
  return env;
}

export function hasModel(name: MapModel): boolean {
  return models.has(name);
}

interface Fit { scale: number; offset: THREE.Vector3; size: THREE.Vector3 }
const fits = new Map<string, Fit>();

/** How to scale/offset a model so it stands on y=0, centred, with the given height (or footprint). */
export function fitOf(name: MapModel, size: number, by: 'height' | 'width' = 'height'): Fit | null {
  const src = models.get(name);
  if (!src) return null;
  let base = fits.get(name);
  if (!base) {
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    const c = box.getCenter(new THREE.Vector3());
    base = { scale: 1, offset: new THREE.Vector3(-c.x, -box.min.y, -c.z), size: box.getSize(new THREE.Vector3()) };
    fits.set(name, base);
  }
  const extent = by === 'height' ? base.size.y : Math.max(base.size.x, base.size.z);
  const scale = size / (extent || 1);
  return { scale, offset: base.offset.clone().multiplyScalar(scale), size: base.size.clone().multiplyScalar(scale) };
}

/** A placed copy of a model (for unique buildings; shares geometry and materials). */
export function placeModel(name: MapModel, size: number, by: 'height' | 'width' = 'height'): THREE.Group | null {
  const src = models.get(name);
  const fit = fitOf(name, size, by);
  if (!src || !fit) return null;
  const inner = src.clone(true);
  inner.scale.multiplyScalar(fit.scale);
  inner.position.copy(fit.offset);
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

interface Part { geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }
const partCache = new Map<string, Part[]>();

function partsOf(name: MapModel): Part[] {
  let parts = partCache.get(name);
  if (parts) return parts;
  parts = [];
  const src = models.get(name);
  if (!src) return parts;
  const root = src.clone(true);
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) parts!.push({ geometry: m.geometry, material: m.material as THREE.Material, local: m.matrixWorld.clone() });
  });
  partCache.set(name, parts);
  return parts;
}

/** Many copies of nature models as instanced meshes: one draw call per model part. */
export class ModelScatter {
  private placed = new Map<MapModel, THREE.Matrix4[]>();

  add(name: MapModel, x: number, y: number, z: number, size: number, rotY = 0, by: 'height' | 'width' = 'height', tilt = 0): void {
    const fit = fitOf(name, size, by);
    if (!fit) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, rotY, tilt * 0.5));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    m.multiply(new THREE.Matrix4().compose(fit.offset, new THREE.Quaternion(), new THREE.Vector3(fit.scale, fit.scale, fit.scale)));
    let list = this.placed.get(name);
    if (!list) this.placed.set(name, (list = []));
    list.push(m);
  }

  build(castShadow = true): THREE.Group {
    const group = new THREE.Group();
    const tmp = new THREE.Matrix4();
    for (const [name, mats] of this.placed) {
      for (const part of partsOf(name)) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, part.local)));
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        group.add(im);
      }
    }
    return group;
  }
}
