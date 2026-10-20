// Shared rendering helpers for the map and the arena: an ambient-occlusion pass that ignores glows and
// helper geometry, and a frame-rate governor that trades internal resolution (then the costliest
// effects) for smoothness, so strong machines keep full quality and weak ones stay playable.
import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

/** Ambient occlusion that skips sprites, particles, additive/transparent effects and invisible helpers. */
export function makeAO(scene: THREE.Scene, camera: THREE.Camera, radius = 0.6): GTAOPass {
  const ao = new GTAOPass(scene, camera, 512, 512);
  ao.blendIntensity = 0.9;
  ao.updateGtaoMaterial({ radius, distanceExponent: 1.4, thickness: 1.2, scale: 1 });
  const g = ao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[] };
  g._overrideVisibility = () => {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      const skip = (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine
        || o.userData.noAO === true || (m && !Array.isArray(m) && (m.transparent || !m.visible || (m as THREE.ShaderMaterial).isShaderMaterial));
      if (skip && o.visible) { o.visible = false; g._visibilityCache.push(o); }
    });
  };
  return ao;
}

const RATIOS = [0.7, 0.85, 1, 1.25, 1.5, 1.75, 2];

/**
 * Watches frame times and steps the render resolution down when frames run long (and back up when there
 * is headroom). At the bottom of the ladder it switches off optional passes (ambient occlusion first).
 */
export class FrameGovernor {
  private level: number;
  private maxLevel: number;
  private acc = 0;
  private frames = 0;
  private slowFor = 0;
  private fastFor = 0;
  private optional: { pass: { enabled: boolean }; on: boolean }[] = [];

  constructor(private renderer: THREE.WebGLRenderer, private composer: EffectComposer | null, maxRatio: number, private onResize: () => void, private targetFps = 60) {
    const cap = Math.min(window.devicePixelRatio || 1, maxRatio);
    this.maxLevel = RATIOS.reduce((best, r, i) => (r <= cap + 0.01 ? i : best), 0);
    this.level = this.maxLevel;
    this.apply();
  }

  /** Passes the governor may switch off when even the lowest resolution is too slow. */
  addOptional(pass: { enabled: boolean }): void {
    this.optional.push({ pass, on: pass.enabled });
  }

  get pixelRatio(): number {
    return RATIOS[this.level];
  }

  /** Call once per rendered frame with the real (unscaled) frame time in seconds. */
  tick(dt: number): void {
    if (dt <= 0 || dt > 0.25) return; // tab switches and hitches say nothing about steady load
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (avg > 1 / (this.targetFps * 0.7)) { this.slowFor += 0.5; this.fastFor = 0; } else if (avg < 1 / (this.targetFps * 0.95)) { this.fastFor += 0.5; this.slowFor = 0; } else { this.slowFor = 0; this.fastFor = 0; }
    if (this.slowFor >= 1.5) {
      this.slowFor = 0;
      const off = this.optional.find((o) => o.pass.enabled);
      if (this.level > 0 && !(this.level <= 2 && off)) { this.level--; this.apply(); }
      else if (off) off.pass.enabled = false;
      else if (this.level > 0) { this.level--; this.apply(); }
    } else if (this.fastFor >= 5) {
      this.fastFor = 0;
      const back = this.optional.find((o) => o.on && !o.pass.enabled);
      if (back) back.pass.enabled = true;
      else if (this.level < this.maxLevel) { this.level++; this.apply(); }
    }
  }

  /** Re-assert this view's resolution after another view used the shared renderer. */
  reapply(): void {
    this.apply();
  }

  private apply(): void {
    this.renderer.setPixelRatio(RATIOS[this.level]);
    this.composer?.setPixelRatio(RATIOS[this.level]);
    this.onResize();
  }
}

let shared: THREE.WebGLRenderer | null = null;

/**
 * The one WebGL renderer (and canvas) shared by the map and the arena. One context means every model
 * and texture lives in GPU memory once - phones kill tabs that hold two copies.
 */
export function sharedRenderer(): THREE.WebGLRenderer {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    shared.shadowMap.enabled = true;
    shared.shadowMap.type = THREE.PCFSoftShadowMap;
    shared.toneMapping = THREE.ACESFilmicToneMapping;
    shared.outputColorSpace = THREE.SRGBColorSpace;
    shared.domElement.style.touchAction = 'none';
    (window as unknown as { __gl?: THREE.WebGLRenderer }).__gl = shared; // test hook (memory checks)
    // the GPU may reclaim the context under memory pressure (common on Android): ask for it back and
    // let the views rebuild
    shared.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); for (const f of [...glListeners]) f('lost'); });
    shared.domElement.addEventListener('webglcontextrestored', () => { for (const f of [...glListeners]) f('restored'); });
  }
  return shared;
}

/** Shrink every texture under `root` to at most `max` pixels (phones: GPU memory is the limit). */
export function capTextures(root: THREE.Object3D, max: number): void {
  const seen = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) capTexture(v as THREE.Texture, max, seen);
    }
  });
}

export function capTexture(t: THREE.Texture, max: number, seen = new Set<THREE.Texture>()): void {
  if (seen.has(t)) return;
  seen.add(t);
  const img = t.image as { width?: number; height?: number } | undefined;
  if (!img || !img.width || !img.height || (img.width <= max && img.height <= max)) return;
  const k = max / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d')!.drawImage(t.image as CanvasImageSource, 0, 0, c.width, c.height);
  (t.image as { close?: () => void }).close?.();
  t.image = c;
  t.needsUpdate = true;
}

/**
 * Free everything a view created on the GPU: its effect passes' buffers, and the geometry, materials and
 * textures of its own objects. Subtrees marked `userData.shared` (models cached for reuse, the fighters)
 * and textures marked `userData.keep` (module-wide caches) are left alone.
 */
export function disposeView(scene: THREE.Scene, composer: EffectComposer | null): void {
  const shared = new Set<THREE.Object3D>();
  scene.traverse((o) => { if (o.userData.shared) o.traverse((c) => shared.add(c)); });
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  // lights own their shadow maps
  scene.traverse((o) => { if ((o as THREE.Light).isLight && !shared.has(o)) (o as THREE.Light).dispose(); });
  scene.traverse((o) => {
    if (shared.has(o) || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
  });
  for (const g of geos) g.dispose();
  for (const mat of mats) {
    for (const v of Object.values(mat)) {
      const t = v as THREE.Texture | null;
      if (t && t.isTexture && !t.userData.keep) t.dispose();
    }
    mat.dispose();
  }
  if (composer) {
    for (const p of composer.passes) (p as { dispose?: () => void }).dispose?.();
    composer.dispose();
  }
}

type GLListener = (state: 'lost' | 'restored') => void;
const glListeners: GLListener[] = [];

/** Hear about the GPU taking the WebGL context away (and giving it back). */
export function onContextChange(f: GLListener): () => void {
  glListeners.push(f);
  return () => { const i = glListeners.indexOf(f); if (i >= 0) glListeners.splice(i, 1); };
}
