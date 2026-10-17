// Dev-only: every realistic model side by side, facing +X like the player's foe would face -X.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { preload3d, preloadAllSf, SF_FILES } from '../src/ui/arena3d/assets3d';
import { Actor3D, SF_TUNE } from '../src/ui/arena3d/Actor3D';
for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('yaw_')) (SF_TUNE as Record<string, { yaw?: number }>)[k.slice(4)].yaw = Number(v) * Math.PI;
for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('grip_')) { const g = v.split(',').map(Number); (SF_TUNE as unknown as Record<string, { grip: object }>)[k.slice(5)].grip = { dir: [g[0], g[1], g[2]], flip: g[3] === 1, len: g[4] || 1, twist: (g[5] || 0) * Math.PI }; }
for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('idle_')) (SF_TUNE as unknown as Record<string, { clips: { idle?: string } }>)[k.slice(5)].clips.idle = v;

const q = new URLSearchParams(location.search);
const anim = q.get('anim') ?? 'Idle_Combat';
const frac = q.has('frac') ? Number(q.get('frac')) : null;
const view = q.get('view') ?? 'side';
const only = q.get('only');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(1600, 800);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333340);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(3, 6, 5); scene.add(d);
const cam = new THREE.PerspectiveCamera(35, 2, 0.1, 200);
await preload3d();
await preloadAllSf();
const actors: Actor3D[] = [];
const label = document.getElementById('l')!;
const grips = q.get('grips')?.split(';').map((v) => v.split(',').map(Number));
const yaws = q.get('yaws')?.split(',').map(Number) ?? grips?.map(() => NaN);
const list = yaws ? yaws.map(() => only!.split(',')[0] as (typeof SF_FILES)[number]) : SF_FILES.filter((n) => !only || only.split(',').includes(n));
list.forEach((n, i) => {
  if (yaws && !Number.isNaN(yaws[i])) SF_TUNE[n].yaw = yaws[i] * Math.PI;
  if (grips) { const g = grips[i]; SF_TUNE[n].grip = { dir: [g[0], g[1], g[2]], flip: g[3] === 1, len: g[4] || 1, twist: (g[5] || 0) * Math.PI }; }
  const a = new Actor3D({ model: 'knight', sf: n, tint: 0x3a7bd5 });
  const col = i % 5, row = Math.floor(i / 5);
  a.root.position.set((col - 2) * 5, 0, row * -6);
  a.root.rotation.y = -Math.PI / 2; // monsters face -X
  scene.add(a.root);
  const grid = new THREE.GridHelper(4, 4); grid.position.copy(a.root.position); scene.add(grid);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), a.root.position.clone().add(new THREE.Vector3(0, 0.05, 1.5)), 1, 0xff0000); scene.add(arrow);
  if (frac !== null) a.pose(anim, frac); else a.play(anim, { loop: anim === 'Idle_Combat' ? true : false });
  actors.push(a);
  const div = document.createElement('div'); div.textContent = `${n}${grips ? ' grip ' + grips[i].join(',') : yaws ? ' yaw ' + yaws[i] : ''} h=${a.height.toFixed(2)} real=${a.realistic}`; div.dataset.i = String(i); label.appendChild(div);
});
if (only) { const n = yaws ? yaws.length : only.split(',').length; cam.position.set((Math.min(n, 5) - 1) * 2.5 - 10, 2.6, 11 + n); cam.lookAt((Math.min(n, 5) - 1) * 2.5 - 10, 1.1, 0); }
else if (view === 'side') { cam.position.set(0, 6, 22); cam.lookAt(0, 0.5, -3); }
else { cam.position.set(0, 30, 0.01); cam.lookAt(0, 0, -3); }
if (q.get('cam')) { const c = q.get('cam')!.split(',').map(Number); cam.position.set(c[0], c[1], c[2]); cam.lookAt(c[3], c[4], c[5]); }
const clock = new THREE.Clock();
let t = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  for (const a of actors) a.update(dt);
  renderer.render(scene, cam);
  const v = new THREE.Vector3();
  label.querySelectorAll('div').forEach((el) => {
    const a = actors[Number((el as HTMLElement).dataset.i)];
    v.copy(a.root.position).add(new THREE.Vector3(0, -0.3, 1.8)).project(cam);
    Object.assign((el as HTMLElement).style, { position: 'absolute', left: `${(v.x + 1) * 800 - 60}px`, top: `${(1 - v.y) * 400}px` });
  });
  (window as unknown as { __t: number }).__t = t;
  requestAnimationFrame(frame);
}
frame();
