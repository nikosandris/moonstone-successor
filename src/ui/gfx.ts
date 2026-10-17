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

  constructor(private renderer: THREE.WebGLRenderer, private composer: EffectComposer | null, maxRatio: number, private onResize: () => void) {
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
    if (avg > 1 / 42) { this.slowFor += 0.5; this.fastFor = 0; } else if (avg < 1 / 57) { this.fastFor += 0.5; this.slowFor = 0; } else { this.slowFor = 0; this.fastFor = 0; }
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

  private apply(): void {
    this.renderer.setPixelRatio(RATIOS[this.level]);
    this.composer?.setPixelRatio(RATIOS[this.level]);
    this.onResize();
  }
}
