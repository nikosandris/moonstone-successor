// The 3D duel stage: renderer, moonlit forest clearing, lights, fog, post-processing and camera rig.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { MoonPhase } from '../../core/types';
import { drawFog, drawMoon } from '../art/textures';
import { cloneProp, type PropFile } from './assets3d';
import { Fx3D } from './Fx3D';

export type Stage3D = 'forest' | 'lair' | 'sanctum';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.55 }, tint: { value: new THREE.Color(0x000000) }, flash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; uniform vec3 tint; uniform float flash; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d) * (1.0 + strength));
    c.rgb *= mix(1.0, v, 0.85); c.rgb = mix(c.rgb, tint, flash); gl_FragColor = c; }`,
};

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function groundTexture(stage: Stage3D): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const base = stage === 'lair' ? [38, 30, 30] : stage === 'sanctum' ? [44, 44, 56] : [30, 40, 30];
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, 512, 512);
  const rnd = seeded(stage.length * 97);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const k = rnd();
    const l = 0.6 + rnd() * 0.9;
    g.fillStyle = `rgba(${base[0] * l + (stage === 'forest' ? 0 : 10)},${base[1] * l + (stage === 'forest' && k > 0.5 ? 14 : 0)},${base[2] * l},${0.25 + rnd() * 0.4})`;
    g.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * (stage === 'forest' ? 6 : 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 200);
  readonly fx = new Fx3D();
  private composer: EffectComposer;
  private vignette: ShaderPass;
  private bloom: UnrealBloomPass;
  private flickers: { light: THREE.PointLight; base: number; seed: number; flame: THREE.Sprite }[] = [];
  private fogPlanes: THREE.Mesh[] = [];
  private time = 0;
  private shake = 0;
  // camera rig
  readonly focus = new THREE.Vector3(0, 1.1, 0);
  private camBase = new THREE.Vector3(-3.4, 2.1, 5.2);
  private camTarget = new THREE.Vector3();
  orbit = 0;
  zoom = 1;
  private zoomTarget = 1;

  constructor(readonly canvas: HTMLCanvasElement, stage: Stage3D, phase: MoonPhase, seed: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = phase === 'full' ? 1.15 : phase === 'new' ? 0.85 : 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.buildStage(stage, phase, seed);
    this.scene.add(this.fx.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 288), 0.55, 0.6, 0.78);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // keep both fighters in frame on narrow screens
    this.camera.fov = w / h < 1.5 ? 46 : 38;
    this.camera.updateProjectionMatrix();
  }

  private buildStage(stage: Stage3D, phase: MoonPhase, seed: number): void {
    const s = this.scene;
    const fogColor = stage === 'lair' ? 0x120a0c : stage === 'sanctum' ? 0x0c0d22 : 0x0a0f1c;
    s.background = new THREE.Color(fogColor);
    s.fog = new THREE.FogExp2(fogColor, stage === 'lair' ? 0.055 : 0.04);

    // sky dome with a vertical gradient, stars and the current moon
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(90, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(stage === 'lair' ? 0x1a0c0e : 0x0b1030) }, bottom: { value: new THREE.Color(fogColor) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(vP.y * 1.6, 0.0, 1.0)), 1.0); }',
      }),
    );
    s.add(sky);
    if (stage !== 'lair') {
      const starGeo = new THREE.BufferGeometry();
      const rnd = seeded(seed + 7);
      const pts: number[] = [];
      for (let i = 0; i < 700; i++) {
        const th = rnd() * Math.PI * 2;
        const ph = Math.acos(0.15 + rnd() * 0.85);
        pts.push(80 * Math.sin(ph) * Math.cos(th), 80 * Math.cos(ph), 80 * Math.sin(ph) * Math.sin(th));
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 0.18, fog: false })));
      const moonTex = new THREE.CanvasTexture(drawMoon(phase, 256));
      moonTex.colorSpace = THREE.SRGBColorSpace;
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true }));
      moon.position.set(18, 26, -60);
      moon.scale.setScalar(phase === 'full' ? 11 : 9);
      s.add(moon);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xbfd0ff, fog: false, transparent: true, opacity: phase === 'full' ? 0.5 : 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.position.copy(moon.position);
      halo.scale.setScalar(34);
      s.add(halo);
    }

    // moonlight (shadow-casting key light), cool ambient, warm/cold fill
    const moonStrength = { new: 0.7, waxing: 1.1, full: 1.7, waning: 1.0 }[phase];
    const key = new THREE.DirectionalLight(stage === 'lair' ? 0xffc0a0 : 0xa8bcff, moonStrength * (stage === 'lair' ? 0.9 : 1.2));
    key.position.set(6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    s.add(key);
    s.add(new THREE.HemisphereLight(0x5a6a9a, 0x1a1418, stage === 'lair' ? 0.9 : 1.0));
    // soft front fill so faces read against the dark
    const fill = new THREE.DirectionalLight(0xffe0c0, 0.45);
    fill.position.set(-1, 2.5, 8);
    s.add(fill);
    const rim = new THREE.DirectionalLight(0x6a8cff, 0.8);
    rim.position.set(-4, 3, -6);
    s.add(rim);

    // ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 64),
      new THREE.MeshStandardMaterial({ map: groundTexture(stage), roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);

    const rnd = seeded(seed);
    const place = (name: PropFile, x: number, z: number, scale: number, rotY = rnd() * Math.PI * 2) => {
      const p = cloneProp(name);
      p.position.set(x, 0, z);
      p.scale.setScalar(scale);
      p.rotation.y = rotY;
      p.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      s.add(p);
      return p;
    };

    if (stage === 'forest' || stage === 'sanctum') {
      // a ring of trees around the clearing, denser and taller further out
      const trees: PropFile[] = ['tree_single_A', 'tree_single_B', 'trees_A_large', 'trees_A_medium', 'trees_B_large'];
      for (let i = 0; i < (stage === 'forest' ? 70 : 34); i++) {
        const a = rnd() * Math.PI * 2;
        const r = 7 + rnd() * 18;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r - (stage === 'forest' ? 2 : 0);
        if (z > 3 && Math.abs(x) < 7) continue; // keep the camera side open
        place(trees[Math.floor(rnd() * trees.length)], x, z, 2.2 + rnd() * 1.6);
      }
      place('mountain_A_grass_trees', -18, -26, 9);
      place('mountain_A_grass_trees', 22, -30, 11);
      place('hill_single_A', 0, -24, 8);
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 4 + rnd() * 6;
      const rocks: PropFile[] = ['rock_single_A', 'rock_single_B', 'rock_single_C'];
      place(rocks[i % 3], Math.cos(a) * r, Math.sin(a) * r - 1, 1.2 + rnd() * 1.6);
    }
    if (stage === 'sanctum') {
      // ring of standing stones
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.2;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.6 + (i % 3) * 0.5, 0.45), new THREE.MeshStandardMaterial({ color: 0x5a5a68, roughness: 1 }));
        stone.position.set(Math.cos(a) * 5.2, 1.3, Math.sin(a) * 5.2 - 1);
        stone.rotation.y = -a;
        stone.castShadow = true;
        stone.receiveShadow = true;
        if (Math.sin(a) * 5.2 - 1 < 3) s.add(stone);
      }
    }
    if (stage === 'lair') {
      // cave mouth: dark rock walls closing in
      for (let i = 0; i < 26; i++) {
        const a = Math.PI * (0.05 + (i / 25) * 0.9);
        const r = 6.5 + rnd() * 1.5;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4 + rnd() * 1.8, 0), new THREE.MeshStandardMaterial({ color: 0x2a2224, roughness: 1, flatShading: true }));
        rock.position.set(Math.cos(a) * r * 1.4, rnd() * 2.5, -Math.sin(a) * r);
        rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        rock.castShadow = true;
        rock.receiveShadow = true;
        s.add(rock);
      }
    }

    // torches with flickering light and embers
    const torchSpots: [number, number][] = stage === 'lair' ? [[-3.2, -1.6], [3.2, -1.6], [0, -4.5]] : [[-3.6, -1.8], [3.6, -2.0]];
    for (const [x, z] of torchSpots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 }));
      pole.position.set(x, 0.8, z);
      pole.castShadow = true;
      s.add(pole);
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff9a40, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(x, 1.75, z);
      flame.scale.set(0.5, 0.8, 1);
      s.add(flame);
      const light = new THREE.PointLight(0xff8a3a, 6, 9, 1.8);
      light.position.set(x, 1.9, z);
      s.add(light);
      this.flickers.push({ light, base: 6, seed: x * 3 + z, flame });
      this.fx.addEmberSource(new THREE.Vector3(x, 1.8, z));
    }
    if (stage === 'sanctum') {
      const altar = new THREE.PointLight(phase === 'full' ? 0xffd27a : 0x8fa8ff, 5, 12, 1.5);
      altar.position.set(0, 2.5, -3);
      s.add(altar);
    }

    // drifting ground fog
    const fogTex = new THREE.CanvasTexture(drawFog());
    fogTex.wrapS = fogTex.wrapT = THREE.RepeatWrapping;
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(40, 40),
        new THREE.MeshBasicMaterial({ map: fogTex.clone(), transparent: true, opacity: 0.16 - i * 0.03, depthWrite: false, color: 0xaab4d8 }),
      );
      f.rotation.x = -Math.PI / 2;
      f.position.y = 0.25 + i * 0.35;
      (f.material as THREE.MeshBasicMaterial).map!.repeat.set(2 + i, 2 + i);
      s.add(f);
      this.fogPlanes.push(f);
    }
  }

  setCamera(base: THREE.Vector3, focus: THREE.Vector3): void {
    this.camBase.copy(base);
    this.focus.copy(focus);
  }

  zoomTo(z: number): void {
    this.zoomTarget = z;
  }

  addShake(amount: number): void {
    this.shake = Math.min(0.5, this.shake + amount);
  }

  /** Screen flash in a colour (0..1), fading out. */
  flash(color: number, amount: number): void {
    (this.vignette.uniforms.tint.value as THREE.Color).setHex(color);
    this.vignette.uniforms.flash.value = amount;
  }

  render(dt: number): void {
    this.time += dt;
    this.fx.update(dt);
    for (const f of this.flickers) {
      const v = 0.8 + 0.2 * Math.sin(this.time * 17 + f.seed) * Math.sin(this.time * 7.3 + f.seed * 2);
      f.light.intensity = f.base * v;
      f.flame.scale.set(0.45 + v * 0.1, 0.7 + v * 0.2, 1);
    }
    this.fogPlanes.forEach((f, i) => {
      const m = (f.material as THREE.MeshBasicMaterial).map!;
      m.offset.x += dt * (0.008 + i * 0.005);
      m.offset.y += dt * 0.003 * (i % 2 ? -1 : 1);
    });
    // camera: base position, slow breathing drift, optional orbit, zoom and shake
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4);
    const off = this.camBase.clone().sub(this.focus);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbit);
    off.multiplyScalar(1 / this.zoom);
    this.camTarget.copy(this.focus).add(off);
    this.camTarget.x += Math.sin(this.time * 0.4) * 0.08;
    this.camTarget.y += Math.sin(this.time * 0.6) * 0.04;
    this.camera.position.copy(this.camTarget);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.002, dt);
    }
    this.camera.lookAt(this.focus);
    const fl = this.vignette.uniforms.flash.value as number;
    if (fl > 0) this.vignette.uniforms.flash.value = Math.max(0, fl - dt * 3.5);
    this.composer.render(dt);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
  }
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
