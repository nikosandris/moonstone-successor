// The board as a living, moonlit miniature landscape: photo-textured terrain, a reflective sea, real
// buildings at every place, forests and rocks, knights as miniatures that walk the roads, and monsters
// waiting at their lairs. Cinematic post-processing (ambient occlusion, bloom, tilt-shift, grading).
// Presentation only: it reads the game state and reports taps on places back to the scene.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { Water } from 'three/addons/objects/Water.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { shortestPath } from '../../core/graph';
import { isSanctumOpen, phaseForDay } from '../../core/moon';
import type { BoardNode, GameState, MoonPhase } from '../../core/types';
import { BOARD } from '../../data/board';
import { drawMoon } from '../art/textures';
import { Actor3D } from '../arena3d/Actor3D';
import { MONSTER_LOOK } from '../arena3d/Arena3D';
import { sfReady } from '../arena3d/assets3d';
import { getLang, t, tn } from '../i18n';
import { FrameGovernor, makeAO, sharedRenderer } from '../gfx';
import { lowGraphics } from '../settings';
import { SEAL_COLORS } from '../theme';
import { ModelScatter, hasModel, mapEnv, mapTexture, placeModel, type MapModel } from './mapAssets';
import { WATER_Y, buildTerrain, fbm, heightAt, islandMask, nodeXZ, roadDist, roadPath } from './terrain';

export interface MapHost {
  onNodeClick(id: number): void;
  onNodeHover(id: number | null): void;
}

export interface MapView {
  state: GameState;
  /** places the human may move to right now (empty when it is not their move) */
  reach: Set<number>;
}

function hash(x: number, y: number, s = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (!glowTex) {
    glowTex = canvasTexture(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    });
  }
  return glowTex;
}

function glowSprite(color: number, size: number, opacity = 0.6): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

/** Tilt-shift focus, colour grade, vignette and film grain, applied after tone mapping. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, time: { value: 0 },
    focus: { value: 0.55 }, blur: { value: 1.0 }, grain: { value: 0.035 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float time, focus, blur, grain;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      // miniature look: sharp band across the middle, soft above and below
      float d = abs(vUv.y - focus);
      float r = smoothstep(0.16, 0.62, d) * blur * 3.2;
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (r > 0.05) {
        vec3 acc = col; float w = 1.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 2.39996;
          float rr = sqrt(float(i) + 0.5) / 3.5;
          vec2 o = vec2(cos(a), sin(a)) * rr * r / resolution * 1.6;
          acc += texture2D(tDiffuse, vUv + o).rgb; w += 1.0;
        }
        col = acc / w;
      }
      // grade: cool shadows, warm highlights, gentle contrast and richness
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.86, 0.95, 1.12), (1.0 - l) * 0.35);
      col = mix(col, col * vec3(1.1, 1.0, 0.86), smoothstep(0.45, 1.0, l) * 0.4);
      col = (col - 0.5) * 1.07 + 0.5;
      col = mix(vec3(l), col, 1.12);
      // vignette and grain
      vec2 q = vUv - 0.5;
      col *= 1.0 - dot(q, q) * 0.85;
      col += (rnd(vUv * resolution) - 0.5) * grain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

interface Place {
  node: BoardNode;
  pos: THREE.Vector3;
  hit: THREE.Mesh;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  label: HTMLDivElement | null;
  gem?: THREE.Mesh;
  glow?: THREE.Sprite;
  light?: THREE.PointLight;
  monster?: Actor3D;
  home?: THREE.Group;
}

interface Pawn {
  id: number;
  actor: Actor3D;
  realistic: boolean;
  path: THREE.Vector3[];
  base: THREE.Mesh;
}

const PHASE_LIGHT: Record<MoonPhase, { key: number; keyI: number; hemi: number; hemiI: number; env: number; sky: [string, string, string]; fog: number; exposure: number }> = {
  new: { key: 0x9db0ff, keyI: 1.6, hemi: 0x3a4670, hemiI: 0.55, env: 0.55, sky: ['#03040b', '#0d1430', '#1d2850'], fog: 0x121a36, exposure: 1.05 },
  waxing: { key: 0xb0c0ff, keyI: 2.0, hemi: 0x435080, hemiI: 0.6, env: 0.65, sky: ['#05071a', '#141d44', '#26356a'], fog: 0x18224a, exposure: 1.1 },
  full: { key: 0xd8e2ff, keyI: 2.7, hemi: 0x52609a, hemiI: 0.7, env: 0.8, sky: ['#070b22', '#1c2a5c', '#3a4e8a'], fog: 0x223060, exposure: 1.18 },
  waning: { key: 0xa8b8f8, keyI: 1.9, hemi: 0x3e4a78, hemiI: 0.58, env: 0.62, sky: ['#04061a', '#121a40', '#222f62'], fog: 0x162046, exposure: 1.08 },
};

export class MapWorld3D {
  readonly root = document.createElement('div');
  private canvas: HTMLCanvasElement;
  private labels = document.createElement('div');
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private final: ShaderPass;
  private gtao: GTAOPass | null = null;
  private governor!: FrameGovernor;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 400);
  private key = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1);
  private skyTex: THREE.CanvasTexture | null = null;
  private moonSprite: THREE.Sprite | null = null;
  private moonPhase: MoonPhase | null = null;
  private water: Water | null = null;
  private nature: THREE.Group | null = null;
  private props: THREE.Group | null = null;
  private places: Place[] = [];
  private pawns: Pawn[] = [];
  private pathDots: THREE.Sprite[] = [];
  private sanctumBeam!: THREE.Mesh;
  private sanctumGlow!: THREE.Sprite;
  private sanctumLight!: THREE.PointLight;
  private fireflies!: THREE.Points;
  private flames: { s: THREE.Sprite; base: number; seed: number }[] = [];
  private banners: THREE.Mesh[] = [];
  private clock = new THREE.Clock();
  private raf = 0;
  private paused = false;
  private view: MapView | null = null;
  private hover: number | null = null;
  private lastPos: number[] = [];
  private lastCurrent = -1;
  private time = 0;
  private mobile: boolean;
  // camera rig: target on the ground, distance, smoothed toward the desired values
  private target = new THREE.Vector3(0, 0, 1);
  private wantTarget = new THREE.Vector3(0, 0, 1);
  private dist = 36;
  private wantDist = 36;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinch0 = 0;
  private ray = new THREE.Raycaster();
  private onResize = () => this.resize();

  constructor(private host: MapHost) {
    this.root.className = 'm3d-root';
    this.labels.className = 'm3d-labels';
    this.renderer = sharedRenderer();
    this.canvas = this.renderer.domElement;
    this.root.append(this.canvas, this.labels);
    this.mobile = lowGraphics();

    const env = mapEnv();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = env ? pmrem.fromEquirectangular(env).texture : pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.fog = new THREE.FogExp2(0x18224a, 0.011);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (!this.mobile) {
      this.gtao = makeAO(this.scene, this.camera);
      this.composer.addPass(this.gtao);
    }
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.55, 0.85));
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.buildLights();
    this.buildSea();
    this.scene.add(buildTerrain(this.mobile));
    this.buildNature();
    this.buildPlaces();
    this.buildAmbience();

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', this.onResize);
    document.body.appendChild(this.root);
    (window as unknown as { __map3d?: MapWorld3D }).__map3d = this; // test hook
    (window as unknown as { __map3dInfo?: () => unknown }).__map3dInfo = () => ({ ...this.renderer.info.render, ratio: this.governor.pixelRatio });
    this.governor = new FrameGovernor(this.renderer, this.composer, this.mobile ? 1.5 : 2, () => this.resize());
    if (this.gtao) this.governor.addOptional(this.gtao);
    this.resize();
    this.loop();
  }

  // ---------------------------------------------------------------- build

  private ground(x: number, z: number): number {
    return heightAt(x, z);
  }

  private buildLights(): void {
    this.key.position.set(-16, 24, 14);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    const sc = this.key.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.04;
    this.scene.add(this.key, this.key.target, this.hemi);
    // a faint warm bounce from the villages' fires
    const fill = new THREE.DirectionalLight(0xffb27a, 0.35);
    fill.position.set(12, 6, 20);
    this.scene.add(fill);
  }

  private buildSea(): void {
    const normals = mapTexture('water');
    if (!normals) return;
    this.water = new Water(new THREE.PlaneGeometry(400, 400), {
      textureWidth: this.mobile ? 256 : 512, textureHeight: this.mobile ? 256 : 512, waterNormals: normals,
      sunDirection: new THREE.Vector3(-0.5, 0.7, -0.5).normalize(), sunColor: 0xc8d6ff, waterColor: 0x02121f, distortionScale: 2.2, fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    (this.water.material as THREE.ShaderMaterial).uniforms.size.value = 4;
    // the mirror pass only needs sky, coast and buildings: skip the forests to halve its cost
    const mirror = this.water.onBeforeRender.bind(this.water);
    this.water.onBeforeRender = (...args: Parameters<typeof mirror>) => {
      const hide = ([this.nature, this.props, this.fireflies] as (THREE.Object3D | null)[]).filter((o): o is THREE.Object3D => !!o);
      for (const o of hide) o.visible = false;
      mirror(...args);
      for (const o of hide) o.visible = true;
    };
    this.scene.add(this.water);
  }

  /** Forests, lone trees, rocks and cliffs, scattered by noise and kept off roads and clearings. */
  private buildNature(): void {
    const sc = new ModelScatter();
    const placesXZ = BOARD.nodes.map((n) => ({ p: nodeXZ(n.id), r: n.type === 'sanctum' ? 4 : n.type === 'road' ? 1.3 : 2.9 }));
    const nearPlace = (x: number, z: number) => placesXZ.some(({ p, r }) => Math.hypot(x - p.x, z - p.y) < r);
    const density = this.mobile ? 0.55 : 1;
    let trees = 0;
    for (let i = 0; i < 2600; i++) {
      const x = (hash(i, 1) - 0.5) * 50, z = (hash(i, 2) - 0.5) * 34;
      if (islandMask(x, z) < 0.9) continue;
      const y = this.ground(x, z);
      if (y < 0.08 || nearPlace(x, z)) continue;
      const rd = roadDist(x, z);
      if (rd < 0.55) continue;
      const forest = fbm(x * 0.16 + 4, z * 0.16 - 3, 4, 31);
      const north = Math.exp(-((x - 0) ** 2 + (z + 9) ** 2) / 50);
      const r = hash(i, 3);
      const steep = y > 1.8;
      if ((forest > 0.5 || north > 0.5 && forest > 0.38) && r < 0.8 * density && trees < 700 * density) {
        const h4 = hash(i, 4);
        sc.add(h4 < 0.55 ? 'pine' : h4 < 0.92 ? 'spruce' : 'deadpine', x, y - 0.05, z, 1.6 + hash(i, 6) * 1.1, hash(i, 7) * 6.28);
        trees++;
      } else if (steep && r < 0.25) {
        sc.add(hash(i, 8) < 0.5 ? 'cliff' : 'cliff2', x, y - 0.3, z, 1.4 + hash(i, 9) * 1.6, hash(i, 7) * 6.28, 'width');
      } else if (r < 0.06 * density) {
        sc.add(hash(i, 8) < 0.5 ? 'rocks_a' : 'rocks_b', x, y - 0.03, z, 0.8 + hash(i, 9) * 0.8, hash(i, 7) * 6.28, 'width');
      } else if (r < 0.085 * density && rd > 1) {
        sc.add(hash(i, 8) < 0.6 ? 'pine' : 'deadtree', x, y - 0.05, z, 1.3 + hash(i, 6) * 0.8, hash(i, 7) * 6.28);
      } else if (r < 0.13) {
        sc.add(hash(i, 8) < 0.5 ? 'bush' : 'ferns', x, y - 0.02, z, 0.35 + hash(i, 6) * 0.3, hash(i, 7) * 6.28);
      }
    }
    // sea cliffs where the coast is steep
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const rx = Math.cos(a) * 24.2, rz = Math.sin(a) * 15.6;
      const m = islandMask(rx, rz);
      if (m < 0.2 || m > 0.85 || hash(i, 11) > 0.45) continue;
      sc.add(hash(i, 12) < 0.5 ? 'cliff' : 'cliff2', rx, this.ground(rx, rz) - 0.6, rz, 2 + hash(i, 13) * 1.8, a + Math.PI / 2, 'width');
    }
    this.nature = sc.build(!this.mobile);
    this.scene.add(this.nature);
  }

  private buildPlaces(): void {
    const ringGeo = new THREE.RingGeometry(0.62, 0.8, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.55, 0.7, 3.2, 24, 1, true);
    beamGeo.translate(0, 1.6, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color(0xffd36a) }, strength: { value: 1 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y / 3.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vY; void main(){ gl_FragColor = vec4(color, (1.0 - vY) * (1.0 - vY) * 0.55 * strength); }',
    });
    const props = new ModelScatter();
    for (const n of BOARD.nodes) {
      const c = nodeXZ(n.id);
      const pos = new THREE.Vector3(c.x, this.ground(c.x, c.y), c.y);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(n.type === 'sanctum' ? 2.4 : n.type === 'road' ? 0.8 : 1.5, 1.5, 2.8, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(pos).add(new THREE.Vector3(0, 1.3, 0));
      hit.userData.node = n.id;
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
      ring.scale.setScalar(n.type === 'road' ? 0.8 : n.type === 'sanctum' ? 2.8 : 1.5);
      const beam = new THREE.Mesh(beamGeo, beamMat.clone());
      beam.position.copy(pos);
      beam.scale.set(ring.scale.x * 0.9, 1, ring.scale.x * 0.9);
      beam.visible = false;
      this.scene.add(hit, ring, beam);
      const place: Place = { node: n, pos, hit, ring, beam, label: null };
      this.buildDiorama(place, props);
      if (n.type !== 'road') {
        const l = document.createElement('div');
        l.className = `m3d-label t-${n.type}`;
        l.innerHTML = `<span>${n.type === 'sanctum' ? tn('The Sanctum') : n.type === 'home' ? tn('Keep') : tn(n.name)}</span>`;
        this.labels.appendChild(l);
        place.label = l;
      }
      this.places.push(place);
    }
    this.props = props.build(!this.mobile);
    this.scene.add(this.props);
  }

  /** Put a unique model at a place, facing the island's heart. */
  private put(name: MapModel, size: number, x: number, z: number, rot: number, by: 'height' | 'width' = 'height', sink = 0.05): THREE.Group | null {
    const g = placeModel(name, size, by);
    if (!g) return null;
    g.position.set(x, this.ground(x, z) - sink, z);
    g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  private flame(x: number, y: number, z: number, color = 0xffa040, size = 0.9): void {
    const s = glowSprite(color, size, 0.75);
    s.position.set(x, y, z);
    this.scene.add(s);
    this.flames.push({ s, base: size, seed: Math.random() * 10 });
  }

  private buildDiorama(p: Place, props: ModelScatter): void {
    const { x, z } = p.pos;
    const n = p.node;
    const face = Math.atan2(-x, -z);
    const at = (ang: number, rad: number) => ({ x: x + Math.sin(face + ang) * rad, z: z + Math.cos(face + ang) * rad });
    switch (n.type) {
      case 'home': {
        // tower and gate; the banner takes the owner's colour once the players are known
        const t = at(Math.PI, 1.25);
        this.put('keep', 3.4, t.x, t.z, face);
        const g = at(Math.PI * 0.62, 1.55);
        this.put('keepgate', 1.5, g.x, g.z, face + 0.5);
        const home = new THREE.Group();
        home.position.copy(p.pos);
        this.scene.add(home);
        p.home = home;
        for (const s of [-1, 1]) {
          const tp = at(s * 0.9, 1.0);
          props.add('lantern', tp.x, this.ground(tp.x, tp.z), tp.z, 0.45, face);
          this.flame(tp.x, this.ground(tp.x, tp.z) + 0.38, tp.z, 0xffa040, 0.7);
        }
        const b = at(-2.2, 1.3);
        props.add('barrel', b.x, this.ground(b.x, b.z), b.z, 0.32);
        props.add('crate', b.x + 0.3, this.ground(b.x + 0.3, b.z), b.z + 0.1, 0.28, 0.5);
        p.light = new THREE.PointLight(0xffa868, 5, 6, 1.6);
        p.light.position.set(x, p.pos.y + 1.4, z);
        this.scene.add(p.light);
        break;
      }
      case 'village': {
        const set: [MapModel, number, number, number][] = [
          ['house1', Math.PI, 1.55, 1.9], ['house2', Math.PI + 1.15, 1.75, 1.7], ['house3', Math.PI - 1.15, 1.75, 1.6], ['mill', 1.9, 2.1, 2.6],
        ];
        for (const [name, ang, rad, size] of set) {
          const q = at(ang, rad);
          if (name === 'mill' && !hasModel('mill')) { this.put('house1', 1.9, q.x, q.z, face + ang + Math.PI); continue; }
          this.put(name, size, q.x, q.z, face + ang + Math.PI);
        }
        const w = at(-1.9, 1.6);
        props.add('barrel', w.x, this.ground(w.x, w.z), w.z, 0.32, 0.4);
        props.add('barrel', w.x + 0.25, this.ground(w.x + 0.25, w.z), w.z - 0.1, 0.3, 1.2);
        props.add('crate', w.x - 0.2, this.ground(w.x - 0.2, w.z + 0.25), w.z + 0.25, 0.3, 0.2);
        const l = at(0.6, 1.0);
        props.add('lantern', l.x, this.ground(l.x, l.z), l.z, 0.45, face);
        this.flame(l.x, this.ground(l.x, l.z) + 0.38, l.z);
        p.light = new THREE.PointLight(0xff9a50, 7, 7, 1.5);
        p.light.position.set(x, p.pos.y + 1.2, z);
        this.scene.add(p.light);
        p.glow = glowSprite(0xffa050, 3.4, 0.22);
        p.glow.position.set(x, p.pos.y + 0.8, z);
        this.scene.add(p.glow);
        break;
      }
      case 'lair': {
        const g = at(Math.PI, 1.0);
        this.put('lairgate', 2.6, g.x, g.z, face, 'height', 0.2);
        for (let i = 0; i < 5; i++) {
          const r = at(Math.PI + (i - 2) * 0.6, 1.9 + hash(n.id, i) * 0.5);
          props.add(i % 2 ? 'rocks_a' : 'rocks_b', r.x, this.ground(r.x, r.z) - 0.1, r.z, 0.7 + hash(n.id, i + 9) * 0.8, i * 1.7, 'width');
        }
        const d = at(2.4, 1.7);
        props.add('deadtree', d.x, this.ground(d.x, d.z), d.z, 1.6, face);
        // embers glowing from the den
        p.glow = glowSprite(0xff3a1c, 2.6, 0.45);
        p.glow.position.set(g.x, p.pos.y + 0.9, g.z);
        this.scene.add(p.glow);
        p.light = new THREE.PointLight(0xff4a2a, 6, 5, 1.6);
        p.light.position.set(g.x, p.pos.y + 1.0, g.z);
        this.scene.add(p.light);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshStandardMaterial({ color: SEAL_COLORS[n.seal!], emissive: SEAL_COLORS[n.seal!], emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.4 }));
        gem.position.set(x, p.pos.y + 3.3, z);
        gem.castShadow = true;
        this.scene.add(gem);
        p.gem = gem;
        break;
      }
      case 'ruins': {
        const kinds: MapModel[] = ['ruin_arch', 'ruin_wall', 'fort'];
        const k = kinds[n.id % 3];
        const b = at(Math.PI, 1.1);
        this.put(k, k === 'ruin_wall' ? 2.2 : k === 'fort' ? 2.6 : 2.1, b.x, b.z, face, k === 'ruin_arch' ? 'height' : 'width');
        for (let i = 0; i < 4; i++) {
          const r = at(i * 1.5 + 0.4, 1.3 + hash(n.id, i) * 0.4);
          props.add('rocks_a', r.x, this.ground(r.x, r.z) - 0.02, r.z, 0.7 + hash(n.id, i + 3) * 0.4, i, 'width');
        }
        p.glow = glowSprite(0x6affc0, 2.2, 0.28);
        p.glow.position.set(b.x, p.pos.y + 0.8, b.z);
        this.scene.add(p.glow);
        break;
      }
      case 'sanctum': {
        this.put('stonehenge', 5.6, x, z, 0.3, 'width', 0.1);
        this.put('altar', 1.2, x, z, face, 'width', 0.02);
        const bm = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { color: { value: new THREE.Color(0xffe0a0) }, strength: { value: 0 } },
          vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform vec3 color; uniform float strength; varying float vY; void main(){ gl_FragColor = vec4(color, (1.0 - vY) * 0.6 * strength); }',
        });
        this.sanctumBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 18, 24, 1, true), bm);
        this.sanctumBeam.position.set(x, p.pos.y + 9.2, z);
        this.sanctumGlow = glowSprite(0x9fb4ff, 6, 0.35);
        this.sanctumGlow.position.set(x, p.pos.y + 1, z);
        this.sanctumLight = new THREE.PointLight(0x9fb4ff, 8, 10, 1.6);
        this.sanctumLight.position.set(x, p.pos.y + 1.8, z);
        this.scene.add(this.sanctumBeam, this.sanctumGlow, this.sanctumLight);
        break;
      }
      case 'road': {
        // a waymark: a lantern, sometimes a camp
        const l = at(Math.PI * 0.75, 0.5);
        props.add('lantern', l.x, this.ground(l.x, l.z), l.z, 0.42, face);
        this.flame(l.x, this.ground(l.x, l.z) + 0.36, l.z, 0xffa050, 0.6);
        if (n.id % 3 === 0) {
          const f = at(-Math.PI * 0.6, 0.75);
          props.add('firepit', f.x, this.ground(f.x, f.z), f.z, 0.55, 0, 'width');
          this.flame(f.x, this.ground(f.x, f.z) + 0.15, f.z, 0xff7a20, 0.9);
        }
        break;
      }
    }
  }

  private buildAmbience(): void {
    const count = this.mobile ? 70 : 160;
    const pts = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pts[i * 3] = (hash(i, 11) - 0.5) * 42;
      pts[i * 3 + 1] = 0.4 + hash(i, 12) * 1.6;
      pts[i * 3 + 2] = (hash(i, 13) - 0.5) * 26;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xd8ff8a, size: 0.26, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.fireflies);
    const sc = 700;
    const sp = new Float32Array(sc * 3);
    for (let i = 0; i < sc; i++) {
      const a = hash(i, 21) * Math.PI * 2;
      const e = 0.08 + hash(i, 22) * 0.9;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * 180;
      sp[i * 3 + 1] = Math.sin(e) * 180;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 180 - 60;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  }

  // ---------------------------------------------------------------- state -> scene

  private labelLang = '';

  update(view: MapView): void {
    const first = !this.view;
    if (getLang() !== this.labelLang) {
      this.labelLang = getLang();
      this.homesBuilt = '';
      for (const pl of this.places) {
        if (pl.label && pl.node.type !== 'home') pl.label.innerHTML = `<span>${pl.node.type === 'sanctum' ? tn('The Sanctum') : tn(pl.node.name)}</span>`;
      }
    }
    this.view = view;
    const s = view.state;
    this.applyPhase(phaseForDay(s.day), isSanctumOpen(s.day));
    this.updateHomes(s);
    this.updateMonsters();
    this.updatePawns(s, first);
    const me = s.players[s.current];
    for (const pl of this.places) {
      const can = view.reach.has(pl.node.id);
      pl.beam.visible = can && pl.node.id !== me.pos;
      (pl.ring.material as THREE.MeshBasicMaterial).color.setHex(pl.node.id === me.pos && can ? 0xffffff : 0xffd36a);
      pl.ring.userData.on = can;
      if (pl.label) pl.label.classList.toggle('reach', can);
      if (pl.gem) {
        const held = me.seals.includes(pl.node.seal!);
        const mat = pl.gem.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = held ? 0.25 : 1.6;
        mat.opacity = held ? 0.45 : 1;
        mat.transparent = held;
      }
      if (pl.node.type === 'ruins' && pl.glow) pl.glow.material.opacity = s.day >= (s.ruinsReady[pl.node.id] ?? 0) ? 0.3 : 0.04;
    }
    if (!view.reach.size) this.showPath(null);
    if (s.current !== this.lastCurrent || first) {
      this.lastCurrent = s.current;
      const pos = this.places[me.pos].pos;
      this.wantTarget.set(pos.x * 0.55, 0, pos.z * 0.5 + 1);
      if (first) this.target.copy(this.wantTarget);
    }
  }

  private applyPhase(phase: MoonPhase, open: boolean): void {
    const L = PHASE_LIGHT[phase];
    this.key.color.setHex(L.key);
    this.key.intensity = L.keyI;
    this.hemi.color.setHex(L.hemi);
    this.hemi.groundColor.setHex(0x1a140c);
    this.hemi.intensity = L.hemiI;
    this.scene.environmentIntensity = L.env;
    (this.scene.fog as THREE.FogExp2).color.setHex(L.fog);
    this.renderer.toneMappingExposure = L.exposure;
    if (this.moonPhase !== phase) {
      this.moonPhase = phase;
      this.skyTex?.dispose();
      this.skyTex = canvasTexture(4, 256, (g) => {
        const gr = g.createLinearGradient(0, 0, 0, 256);
        gr.addColorStop(0, L.sky[0]);
        gr.addColorStop(0.6, L.sky[1]);
        gr.addColorStop(1, L.sky[2]);
        g.fillStyle = gr;
        g.fillRect(0, 0, 4, 256);
      });
      this.scene.background = this.skyTex;
      if (this.moonSprite) this.scene.remove(this.moonSprite);
      const tex = new THREE.CanvasTexture(drawMoon(phase, 256));
      tex.colorSpace = THREE.SRGBColorSpace;
      this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, transparent: true }));
      this.moonSprite.position.set(-40, 50, -130);
      this.moonSprite.scale.setScalar(phase === 'full' ? 24 : 17);
      this.scene.add(this.moonSprite);
    }
    (this.sanctumBeam.material as THREE.ShaderMaterial).uniforms.strength.value = open ? 1 : 0;
    this.sanctumGlow.material.color.setHex(open ? 0xffd060 : 0x9fb4ff);
    this.sanctumGlow.scale.setScalar(open ? 9 : 5);
    this.sanctumLight.color.setHex(open ? 0xffd27a : 0x9fb4ff);
    this.sanctumLight.intensity = open ? 18 : 7;
  }

  private homesBuilt = '';
  private updateHomes(s: GameState): void {
    const key = s.players.map((p) => `${p.seat}:${p.color}:${p.name}`).join(',');
    if (key === this.homesBuilt) return;
    this.homesBuilt = key;
    for (const pl of this.places) {
      if (pl.node.type !== 'home' || !pl.home) continue;
      pl.home.clear();
      this.banners = this.banners.filter((b) => b.parent);
      const owner = s.players.find((p) => p.seat === pl.node.seat);
      const face = Math.atan2(-pl.pos.x, -pl.pos.z);
      const hexc = owner ? `#${owner.color.toString(16).padStart(6, '0')}` : '#77706a';
      // a tall banner in the owner's colour
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x2a1e14, roughness: 0.8 }));
      const side = new THREE.Vector3(Math.sin(face + 1.25), 0, Math.cos(face + 1.25)).multiplyScalar(1.15);
      pole.position.set(side.x, 1.1, side.z);
      pole.castShadow = true;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.85, 8, 8), new THREE.MeshStandardMaterial({ color: owner ? owner.color : 0x55504a, roughness: 0.85, side: THREE.DoubleSide, emissive: owner ? owner.color : 0, emissiveIntensity: 0.12 }));
      cloth.position.set(side.x + 0.28 * Math.cos(face), 1.75, side.z - 0.28 * Math.sin(face));
      cloth.rotation.y = face + Math.PI / 2;
      cloth.castShadow = true;
      cloth.userData.base = (cloth.geometry.getAttribute('position') as THREE.BufferAttribute).array.slice();
      this.banners.push(cloth);
      pl.home.add(pole, cloth);
      if (owner) {
        const pool = glowSprite(owner.color, 2.6, 0.28);
        pool.position.set(0, 0.5, 0);
        pl.home.add(pool);
      }
      if (pl.label) {
        pl.label.innerHTML = `<span>${owner ? t("{name}'s Keep", { name: owner.name }) : t('Empty Keep')}</span>`;
        pl.label.style.setProperty('--c', hexc);
      }
    }
  }

  private updateMonsters(): void {
    for (const pl of this.places) {
      if (pl.node.type !== 'lair' && pl.node.type !== 'sanctum') continue;
      const id = pl.node.type === 'sanctum' ? 'guardian' : pl.node.monster!;
      const look = MONSTER_LOOK[id];
      if (!look) continue;
      const want = !!look.sf && sfReady(look.sf);
      if (pl.monster && pl.monster.realistic === want) continue;
      if (pl.monster) { this.scene.remove(pl.monster.root); pl.monster.dispose(); }
      try {
        const a = new Actor3D(look);
        const s = Math.min(1.5 / a.height, 2.2 / (a.reach * 2));
        a.root.scale.setScalar(s * (pl.node.type === 'sanctum' ? 1.15 : 1));
        const face = Math.atan2(-pl.pos.x, -pl.pos.z);
        const back = pl.node.type === 'sanctum' ? 0 : 0.1;
        const mx = pl.pos.x - Math.sin(face) * back, mz = pl.pos.z - Math.cos(face) * back;
        a.root.position.set(mx, this.ground(mx, mz) + (pl.node.type === 'sanctum' ? 0.4 : 0), mz);
        a.root.rotation.y = face;
        this.scene.add(a.root);
        pl.monster = a;
      } catch { /* models not loaded yet */ }
    }
  }

  private slot(nodeId: number, playerId: number, s: GameState): THREE.Vector3 {
    const pl = this.places[nodeId];
    const here = s.players.filter((q) => q.pos === nodeId).map((q) => q.id);
    const i = Math.max(0, here.indexOf(playerId));
    const spread = here.length > 1 ? (i - (here.length - 1) / 2) * 0.6 : 0;
    const face = Math.atan2(-pl.pos.x, -pl.pos.z);
    const fwd = pl.node.type === 'road' ? 0 : pl.node.type === 'sanctum' ? 1.5 : 0.75;
    const x = pl.pos.x + Math.sin(face) * fwd + Math.cos(face) * spread;
    const z = pl.pos.z + Math.cos(face) * fwd - Math.sin(face) * spread;
    return new THREE.Vector3(x, this.ground(x, z), z);
  }

  private updatePawns(s: GameState, first: boolean): void {
    const knightReal = sfReady('knight');
    for (const p of s.players) {
      let pawn = this.pawns.find((q) => q.id === p.id);
      if (pawn && pawn.realistic !== knightReal) {
        this.scene.remove(pawn.actor.root, pawn.base);
        pawn.actor.dispose();
        this.pawns = this.pawns.filter((q) => q !== pawn);
        pawn = undefined;
      }
      if (!pawn) {
        let actor: Actor3D;
        try { actor = new Actor3D({ model: 'knight', sf: 'knight', tint: p.color }); } catch { continue; }
        actor.root.scale.setScalar(1.05 / actor.height);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.06, 32), new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.6 }));
        base.castShadow = true;
        this.scene.add(actor.root, base);
        pawn = { id: p.id, actor, realistic: actor.realistic, path: [], base };
        actor.root.position.copy(this.slot(p.pos, p.id, s));
        this.pawns.push(pawn);
      }
      const from = this.lastPos[p.id];
      const dest = this.slot(p.pos, p.id, s);
      if (!first && from !== undefined && from !== p.pos && !p.downed) {
        // follow the actual roads, hop by hop
        const route = shortestPath(from, p.pos);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < route.length - 1; i++) {
          for (const q of roadPath(route[i], route[i + 1])) pts.push(new THREE.Vector3(q.x, this.ground(q.x, q.y), q.y));
        }
        pts.push(dest);
        pawn.path = pts;
        pawn.actor.play('Walk');
      } else if (!pawn.path.length) {
        pawn.path = pawn.actor.root.position.distanceTo(dest) > 0.05 ? [dest] : [];
        if (p.downed && from !== p.pos) { pawn.actor.root.position.copy(dest); pawn.path = []; }
      }
      (pawn.base.material as THREE.MeshStandardMaterial).emissiveIntensity = p.id === s.current ? 1.5 : 0.35;
    }
    this.lastPos = s.players.map((p) => p.pos);
  }

  // ---------------------------------------------------------------- input

  private ndc(e: PointerEvent | MouseEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(e: PointerEvent | MouseEvent): number | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObjects(this.places.map((p) => p.hit), false);
    return hits.length ? (hits[0].object.userData.node as number) : null;
  }

  private onDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragMoved = 0;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (prev) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.wantDist = THREE.MathUtils.clamp(this.wantDist * (this.pinch0 / d), 9, 44);
        this.pinch0 = d;
      } else if (this.dragMoved > 6) {
        const k = this.dist * 0.0016 * (900 / Math.max(500, this.canvas.clientHeight));
        this.wantTarget.x = THREE.MathUtils.clamp(this.wantTarget.x - dx * k, -20, 20);
        this.wantTarget.z = THREE.MathUtils.clamp(this.wantTarget.z - dy * k * 1.3, -13, 14);
      }
      return;
    }
    if (e.pointerType === 'mouse') this.setHover(this.pick(e));
  };

  private onUp = (e: PointerEvent) => {
    const was = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch0 = 0;
    if (!was || this.dragMoved > 8 || e.type === 'pointercancel') return;
    const id = this.pick(e);
    if (id === null) return;
    if (e.pointerType !== 'mouse') this.setHover(id);
    this.host.onNodeClick(id);
  };

  private onLeave = () => {
    if (!this.pointers.size) this.setHover(null);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wantDist = THREE.MathUtils.clamp(this.wantDist * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 9, 44);
  };

  private setHover(id: number | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.canvas.style.cursor = id !== null ? 'pointer' : '';
    const v = this.view;
    this.showPath(v && id !== null && v.reach.has(id) ? id : null);
    this.host.onNodeHover(id);
  }

  /** Glowing footsteps along the roads from the current knight to a reachable place. */
  private showPath(to: number | null): void {
    for (const d of this.pathDots) this.scene.remove(d);
    this.pathDots = [];
    if (to === null || !this.view) return;
    const me = this.view.state.players[this.view.state.current];
    const ids = shortestPath(me.pos, to);
    let acc = 0;
    let prev = nodeXZ(ids[0]);
    for (let i = 0; i < ids.length - 1; i++) {
      for (const q of roadPath(ids[i], ids[i + 1])) {
        acc += q.distanceTo(prev);
        prev = q;
        if (acc < 0.5) continue;
        acc = 0;
        const d = glowSprite(0xffe39a, 0.38, 0.9);
        d.position.set(q.x, this.ground(q.x, q.y) + 0.12, q.y);
        this.scene.add(d);
        this.pathDots.push(d);
      }
    }
  }

  /** Screen position (CSS px, relative to the viewport) of a place, for tooltips and the tutorial. */
  screenOf(nodeId: number, lift = 1): { x: number; y: number } | null {
    const pl = this.places[nodeId];
    if (!pl) return null;
    const v = pl.pos.clone().add(new THREE.Vector3(0, lift, 0)).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  focus(nodeId: number): void {
    const pos = this.places[nodeId].pos;
    this.wantTarget.set(pos.x, 0, pos.z + 1);
  }

  /** Jump the camera (tests and the tutorial use it). */
  lookAt(nodeId: number, dist: number): void {
    this.focus(nodeId);
    this.wantDist = dist;
    this.target.copy(this.wantTarget);
    this.dist = dist;
  }

  zoomBy(f: number): void {
    this.wantDist = THREE.MathUtils.clamp(this.wantDist * f, 9, 44);
  }

  // ---------------------------------------------------------------- frame loop

  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.root.style.visibility = p ? 'hidden' : '';
    if (!p) {
      // the arena borrowed the shared canvas: take it back and restore this view's settings
      if (this.canvas.parentElement !== this.root) this.root.insertBefore(this.canvas, this.labels);
      this.renderer.shadowMap.needsUpdate = true;
      this.governor.reapply();
      if (this.view) this.applyPhase(phaseForDay(this.view.state.day), isSanctumOpen(this.view.state.day));
      this.clock.getDelta();
    }
  }

  private resize(): void {
    if (!this.final) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.final.uniforms.resolution.value.set(w * pr, h * pr);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.4 ? 44 : 32;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.paused) return;
    const raw = this.clock.getDelta();
    this.governor.tick(raw);
    const dt = Math.min(0.05, raw);
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-dt * 4);
    this.target.lerp(this.wantTarget, k);
    this.dist += (this.wantDist - this.dist) * k;
    const pitch = THREE.MathUtils.degToRad(44 + (this.dist - 9) * 0.45);
    const gy = Math.max(0, this.ground(this.target.x, this.target.z));
    this.camera.position.set(this.target.x, gy + Math.sin(pitch) * this.dist, this.target.z + Math.cos(pitch) * this.dist);
    this.camera.lookAt(this.target.x, gy, this.target.z);
    this.key.target.position.set(this.target.x * 0.3, 0, this.target.z * 0.3);
    // the focus band follows the zoom: close up, a stronger miniature effect
    this.final.uniforms.blur.value = THREE.MathUtils.clamp(1.6 - this.dist / 30, 0.25, 1.2);
    this.final.uniforms.time.value = t % 100;
    if (this.water) (this.water.material as THREE.ShaderMaterial).uniforms.time.value = t * 0.35;
    const fp = this.fireflies.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setY(i, 0.5 + hash(i, 12) * 1.6 + Math.sin(t * 0.8 + i) * 0.15);
    fp.needsUpdate = true;
    (this.fireflies.material as THREE.PointsMaterial).opacity = 0.5 + Math.sin(t * 2.3) * 0.2;
    for (const f of this.flames) {
      const v = 0.82 + 0.18 * Math.sin(t * 9 + f.seed * 7) * Math.sin(t * 3.7 + f.seed);
      f.s.scale.setScalar(f.base * v);
    }
    // banners ripple in the wind
    for (const b of this.banners) {
      const pa = b.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = b.userData.base as Float32Array;
      for (let i = 0; i < pa.count; i++) {
        const x0 = base[i * 3], y0 = base[i * 3 + 1];
        const w = (x0 + 0.275) / 0.55;
        pa.setZ(i, Math.sin(t * 3.2 + x0 * 7 + y0 * 3) * 0.06 * w);
      }
      pa.needsUpdate = true;
    }
    const pulse = 0.55 + Math.sin(t * 4) * 0.25;
    for (const pl of this.places) {
      const on = pl.ring.userData.on as boolean;
      const hov = pl.node.id === this.hover;
      const mat = pl.ring.material as THREE.MeshBasicMaterial;
      mat.opacity = on ? (hov ? 1 : pulse) : hov ? 0.35 : 0;
      if (pl.beam.visible) (pl.beam.material as THREE.ShaderMaterial).uniforms.strength.value = hov ? 1.6 : 0.6 + pulse * 0.4;
      if (pl.gem) {
        pl.gem.rotation.y += dt * 1.2;
        pl.gem.position.y = pl.pos.y + 3.3 + Math.sin(t * 1.6 + pl.node.id) * 0.12;
      }
      if (pl.light) pl.light.intensity = (pl.node.type === 'village' ? 7 : pl.node.type === 'lair' ? 6 : 5) * (0.85 + 0.15 * Math.sin(t * 8 + pl.node.id) * Math.sin(t * 3.1));
      pl.monster?.update(dt);
    }
    for (const pw of this.pawns) {
      pw.actor.update(dt);
      const r = pw.actor.root;
      if (pw.path.length) {
        const to = pw.path[0];
        const d = to.clone().sub(r.position);
        d.y = 0;
        const step = dt * 2.4;
        if (d.length() <= step) {
          r.position.copy(to);
          pw.path.shift();
          if (!pw.path.length) pw.actor.play('Idle_Combat');
        } else {
          r.position.add(d.normalize().multiplyScalar(step));
          r.position.y = this.ground(r.position.x, r.position.z);
          const yaw = Math.atan2(d.x, d.z);
          r.rotation.y += Math.atan2(Math.sin(yaw - r.rotation.y), Math.cos(yaw - r.rotation.y)) * Math.min(1, dt * 10);
        }
      } else {
        r.rotation.y += Math.atan2(Math.sin(0 - r.rotation.y), Math.cos(0 - r.rotation.y)) * Math.min(1, dt * 3);
      }
      pw.base.position.set(r.position.x, r.position.y + 0.03, r.position.z);
    }
    this.composer.render();
    this.placeLabels();
  };

  private placeLabels(): void {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const near = this.dist < 24;
    for (const pl of this.places) {
      if (!pl.label) continue;
      v.copy(pl.pos).setY(pl.pos.y + (pl.node.type === 'sanctum' ? 3 : pl.node.type === 'home' ? 3.6 : pl.node.type === 'lair' ? 3.9 : 2.3)).project(this.camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
      const show = !off && (near || pl.node.type !== 'ruins' || pl.label.classList.contains('reach') || pl.node.id === this.hover);
      pl.label.style.display = show ? '' : 'none';
      if (show) pl.label.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) translate(-50%, -100%)`;
      pl.label.classList.toggle('hover', pl.node.id === this.hover);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    for (const pw of this.pawns) pw.actor.dispose();
    for (const pl of this.places) pl.monster?.dispose();
    this.composer.dispose();
    // the renderer is shared with the arena and outlives the board
    this.root.remove();
  }
}
