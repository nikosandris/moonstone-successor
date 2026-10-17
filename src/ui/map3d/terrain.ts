// The island's ground: a height field shaped around the board (flat clearings at the places, dirt roads
// pressed into the earth, ridges in the west, a sunken bog in the east, cliffs into the sea) and a
// splat material blending five photo-scanned ground textures.
import * as THREE from 'three';
import { BOARD } from '../../data/board';
import { mapTexture } from './mapAssets';

export const WATER_Y = 0;
const SCALE = 26;
const W = 64, D = 44; // terrain extent in world units
const SEG_X = 320, SEG_Z = 220;

export function nodeXZ(id: number): THREE.Vector2 {
  const n = BOARD.nodes[id];
  return new THREE.Vector2((n.x - 500) / SCALE, (n.y - 300) / SCALE);
}

function hash(x: number, y: number, s = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function noise(x: number, y: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 5, s = 0): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += noise(x * f, y * f, s + i) * amp; amp *= 0.5; f *= 2.03; }
  return v;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Roads as gently bent curves; the map draws them into the ground and walks pawns along them. */
export interface Road { a: number; b: number; pts: THREE.Vector2[] }
export const ROADS: Road[] = BOARD.edges.map(([a, b]) => {
  const pa = nodeXZ(a), pb = nodeXZ(b);
  const dir = pb.clone().sub(pa);
  const perp = new THREE.Vector2(-dir.y, dir.x).normalize();
  const ctrl = pa.clone().add(pb).multiplyScalar(0.5).add(perp.multiplyScalar((hash(a, b, 5) - 0.5) * 1.4));
  const steps = Math.max(8, Math.ceil(dir.length() * 2.5));
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(pa.clone().multiplyScalar((1 - t) ** 2).add(ctrl.clone().multiplyScalar(2 * (1 - t) * t)).add(pb.clone().multiplyScalar(t * t)));
  }
  return { a, b, pts };
});

/** Points along the road between two neighbouring places (for walking). */
export function roadPath(from: number, to: number): THREE.Vector2[] {
  const r = ROADS.find((x) => (x.a === from && x.b === to) || (x.a === to && x.b === from));
  if (!r) return [nodeXZ(to)];
  const pts = r.a === from ? r.pts : [...r.pts].reverse();
  return pts.slice(1);
}

// spatial grid of road segments for fast distance queries
const CELL = 2;
const grid = new Map<string, [THREE.Vector2, THREE.Vector2][]>();
for (const r of ROADS) {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    const minx = Math.floor((Math.min(a.x, b.x) - 2) / CELL), maxx = Math.floor((Math.max(a.x, b.x) + 2) / CELL);
    const minz = Math.floor((Math.min(a.y, b.y) - 2) / CELL), maxz = Math.floor((Math.max(a.y, b.y) + 2) / CELL);
    for (let gx = minx; gx <= maxx; gx++) for (let gz = minz; gz <= maxz; gz++) {
      const k = `${gx},${gz}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push([a, b]);
    }
  }
}
const tmpA = new THREE.Vector2(), tmpB = new THREE.Vector2();
export function roadDist(x: number, z: number): number {
  const segs = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!segs) return 9;
  let best = 9;
  for (const [a, b] of segs) {
    tmpA.set(b.x - a.x, b.y - a.y);
    const t = Math.max(0, Math.min(1, ((x - a.x) * tmpA.x + (z - a.y) * tmpA.y) / tmpA.lengthSq()));
    tmpB.set(a.x + tmpA.x * t - x, a.y + tmpA.y * t - z);
    best = Math.min(best, tmpB.length());
  }
  return best;
}

const PLACES = BOARD.nodes.map((n) => ({ n, p: nodeXZ(n.id), r: n.type === 'sanctum' ? 3.2 : n.type === 'road' ? 0.9 : 2.1 }));
const BOG = nodeXZ(6), RIDGE = nodeXZ(8), WOLF = nodeXZ(5), RUST = nodeXZ(7);

/** 0 = sea, 1 = inland. */
export function islandMask(x: number, z: number): number {
  const d = Math.pow((Math.abs(x) / 24.5) ** 4 + (Math.abs(z) / 16) ** 4, 0.25) + (fbm(x * 0.18 + 9, z * 0.18, 3) - 0.5) * 0.22;
  return smooth(1.06, 0.88, d);
}

/** Distance to the nearest place, and its clearing radius. */
function nearestPlace(x: number, z: number): { d: number; r: number; type: string } {
  let best = { d: 99, r: 1, type: 'road' };
  for (const pl of PLACES) {
    const d = Math.hypot(x - pl.p.x, z - pl.p.y) - pl.r;
    if (d < best.d) best = { d, r: pl.r, type: pl.n.type };
  }
  return best;
}

export function heightAt(x: number, z: number): number {
  const m = islandMask(x, z);
  let h = -2.6 + m * 2.85;
  const hills = fbm(x * 0.11, z * 0.11, 5, 3);
  h += (hills - 0.45) * 1.3 * m;
  // western ridges by the drake's cave and a ring of high ground near the coast
  const ridged = Math.pow(1 - Math.abs(fbm(x * 0.16, z * 0.16, 4, 7) * 2 - 1), 2.2);
  const nearRidge = Math.exp(-((x - RIDGE.x) ** 2 + (z - RIDGE.y) ** 2) / 40);
  const coastBand = smooth(0.55, 0.95, Math.pow((Math.abs(x) / 24.5) ** 4 + (Math.abs(z) / 16) ** 4, 0.25));
  h += ridged * (3.6 * nearRidge + 1.6 * coastBand * m + 0.5 * Math.exp(-((x - WOLF.x) ** 2 + (z - WOLF.y) ** 2) / 30));
  // the troll bog sinks into black pools
  const bog = Math.exp(-((x - BOG.x) ** 2 + (z - BOG.y) ** 2) / 22);
  h -= bog * smooth(0.45, 0.7, fbm(x * 0.35, z * 0.35, 3, 11)) * 0.9;
  // rocky broken ground around the rust keep
  h += Math.exp(-((x - RUST.x) ** 2 + (z - RUST.y) ** 2) / 26) * (fbm(x * 0.5, z * 0.5, 3, 13) - 0.4) * 0.8;
  // clearings at the places and roads pressed into the ground
  const np = nearestPlace(x, z);
  const clear = 1 - smooth(0, 1.6, np.d);
  h += (0.22 - h) * clear;
  const rd = roadDist(x, z);
  const onRoad = 1 - smooth(0.2, 1.1, rd);
  const roadH = 0.2 + (hills - 0.45) * 0.35;
  h += (roadH - h) * onRoad * (1 - clear * 0.5);
  h -= 0.035 * (1 - smooth(0, 0.3, rd));
  return h;
}

/** Splat weights: dirt, rock, moss, mud (grass fills the rest). */
function splatAt(x: number, z: number, h: number, slope: number): [number, number, number, number] {
  const rd = roadDist(x, z);
  const np = nearestPlace(x, z);
  let dirt = 1 - smooth(0.1, 0.3, rd + (fbm(x * 1.7, z * 1.7, 2, 21) - 0.5) * 0.14);
  if (np.type !== 'road') dirt = Math.max(dirt, (1 - smooth(-1.2, 0.2, np.d)) * (np.type === 'lair' ? 0.5 : 0.85) * smooth(0.25, 0.6, fbm(x * 0.9, z * 0.9, 3, 22)));
  let rock = smooth(0.32, 0.6, slope) + smooth(1.3, 2.6, h) * 0.8;
  rock = Math.min(1, rock);
  const bog = Math.exp(-((x - BOG.x) ** 2 + (z - BOG.y) ** 2) / 26);
  let mud = Math.max(smooth(0.18, 0.02, h) * smooth(-0.6, -0.1, h - 0.2) * 1.2, bog * 0.7);
  if (h < -0.15) mud = 1;
  const moss = smooth(0.4, 0.62, fbm(x * 0.22, z * 0.22, 4, 23)) * 0.9;
  mud = Math.min(1, mud) * (1 - rock * 0.5);
  dirt *= 1 - rock * 0.6;
  return [dirt, rock, moss * (1 - dirt) * (1 - rock), mud];
}

export function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(W, D, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const w = splatAt(pos.getX(i), pos.getZ(i), pos.getY(i), 1 - nrm.getY(i));
    splat.set(w, i * 4);
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));

  const mat = splatMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Ground material blending five photo-scanned layers by a per-vertex `splat` attribute
 * (dirt, rock, moss, mud; grass fills the rest). Used by the map and the arena.
 */
export function splatMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const tex = (n: string) => ({ value: mapTexture(n) });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tGrass: tex('grass_diff'), tDirt: tex('dirt_diff'), tRock: tex('rock_diff'), tMoss: tex('moss_diff'), tMud: tex('mud_diff'),
      nGrass: tex('grass_nor'), nDirt: tex('dirt_nor'), nRock: tex('rock_nor'), nMoss: tex('moss_nor'), nMud: tex('mud_nor'),
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tDirt, tRock, tMoss, tMud, nGrass, nDirt, nRock, nMoss, nMud;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNrm;
vec3 splatW;
float wG, wD, wR, wM, wU;
vec2 tuv;
// sharpen the blend using each layer's brightness as a height, so stones poke through grass
void weights(vec3 cg, vec3 cd, vec3 cr, vec3 cm, vec3 cu) {
  vec4 s = clamp(vSplat, 0.0, 1.0);
  float g = max(0.0, 1.0 - s.x - s.y - s.z - s.w);
  float hg = dot(cg, vec3(0.33)), hd = dot(cd, vec3(0.33)), hr = dot(cr, vec3(0.33)), hm = dot(cm, vec3(0.33)), hu = dot(cu, vec3(0.33));
  float a = g + hg * 0.6, b = s.x + hd * 0.6, c = s.y + hr * 0.6, d = s.z + hm * 0.6, e = s.w + hu * 0.6;
  float top = max(max(max(a, b), max(c, d)), e) - 0.25;
  wG = max(a - top, 0.0); wD = max(b - top, 0.0); wR = max(c - top, 0.0); wM = max(d - top, 0.0); wU = max(e - top, 0.0);
  float sum = wG + wD + wR + wM + wU + 1e-4;
  wG /= sum; wD /= sum; wR /= sum; wM /= sum; wU /= sum;
}
`)
      .replace('#include <map_fragment>', `
tuv = vWPos.xz * 0.32;
vec2 tuv2 = vWPos.xz * 0.075 + vec2(0.37, 0.71);
vec3 cg = mix(texture2D(tGrass, tuv).rgb, texture2D(tGrass, tuv2).rgb, 0.45) * vec3(0.92, 1.08, 0.78);
vec3 cd = texture2D(tDirt, tuv * 0.9).rgb * vec3(1.25, 1.15, 1.0);
vec3 cr = mix(texture2D(tRock, tuv * 0.5).rgb, texture2D(tRock, tuv2).rgb, 0.4);
vec3 cm = texture2D(tMoss, tuv * 0.8).rgb * vec3(0.95, 1.1, 0.85);
vec3 cu = texture2D(tMud, tuv * 0.8).rgb;
weights(cg, cd, cr, cm, cu);
// large-scale tonal variation breaks up any visible tiling
float macro = texture2D(tMoss, vWPos.xz * 0.013).g;
diffuseColor.rgb = (cg * wG + cd * wD + cr * wR + cm * wM + cu * wU) * (0.82 + macro * 0.38);
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.95 * wG + 0.9 * wD + 0.8 * wR + 0.95 * wM + 0.45 * wU;')
      .replace('#include <normal_fragment_maps>', `
{
  vec3 ng = texture2D(nGrass, tuv).xyz * 2.0 - 1.0;
  vec3 nd = texture2D(nDirt, tuv * 0.9).xyz * 2.0 - 1.0;
  vec3 nr = texture2D(nRock, tuv * 0.5).xyz * 2.0 - 1.0;
  vec3 nm = texture2D(nMoss, tuv * 0.8).xyz * 2.0 - 1.0;
  vec3 nu = texture2D(nMud, tuv * 0.8).xyz * 2.0 - 1.0;
  vec3 tn = normalize(ng * wG + nd * wD + nr * wR + nm * wM + nu * wU);
  vec3 N = normalize(vWNrm);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(N, T);
  vec3 wn = normalize(T * tn.x * 1.2 + B * tn.y * 1.2 + N * tn.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`);
  };
  return mat;
}
