// Lightweight CPU particles and ground decals: blood, sparks, dust, embers.
import * as THREE from 'three';

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
}

function dotTexture(soft: boolean): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(soft ? 0.25 : 0.6, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(90,6,6,0.9)';
  for (let i = 0; i < 14; i++) {
    const r = 8 + Math.random() * 26;
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 30;
    g.beginPath();
    g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A pool of points that share one material (one draw call per kind). */
class Emitter {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;

  constructor(private max: number, material: THREE.PointsMaterial, private gravity: number, private drag: number) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
  }

  spawn(at: THREE.Vector3, n: number, speed: [number, number], spread: THREE.Vector3, life: [number, number], upBias = 0): void {
    for (let i = 0; i < n && this.parts.length < this.max; i++) {
      const dir = new THREE.Vector3((Math.random() - 0.5) * 2 * spread.x, (Math.random() - 0.5) * 2 * spread.y + upBias, (Math.random() - 0.5) * 2 * spread.z).normalize();
      const sp = speed[0] + Math.random() * (speed[1] - speed[0]);
      const l = life[0] + Math.random() * (life[1] - life[0]);
      this.parts.push({ p: at.clone(), v: dir.multiplyScalar(sp), life: l, max: l });
    }
  }

  update(dt: number): void {
    const keep: Particle[] = [];
    for (const q of this.parts) {
      q.life -= dt;
      if (q.life <= 0) continue;
      q.v.y -= this.gravity * dt;
      q.v.multiplyScalar(1 - this.drag * dt);
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.02) {
        q.p.y = 0.02;
        q.v.set(q.v.x * 0.3, 0, q.v.z * 0.3);
      }
      keep.push(q);
    }
    this.parts = keep;
    keep.forEach((q, i) => this.pos.set([q.p.x, q.p.y, q.p.z], i * 3));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.setDrawRange(0, keep.length);
  }
}

export class Fx3D {
  readonly group = new THREE.Group();
  private blood: Emitter;
  private sparks: Emitter;
  private dust: Emitter;
  private embers: Emitter;
  private decals: { mesh: THREE.Mesh; life: number }[] = [];
  private splatTex = splatTexture();
  private emberSources: THREE.Vector3[] = [];
  private emberTimer = 0;
  bloodOn = true;

  constructor() {
    const hard = dotTexture(false);
    const soft = dotTexture(true);
    this.blood = new Emitter(400, new THREE.PointsMaterial({ map: hard, color: 0x9a0d0d, size: 0.07, transparent: true, depthWrite: false }), 9, 0.4);
    this.sparks = new Emitter(300, new THREE.PointsMaterial({ map: soft, color: 0xffd38a, size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 6, 1.5);
    this.dust = new Emitter(200, new THREE.PointsMaterial({ map: soft, color: 0x8a7e72, size: 0.35, transparent: true, opacity: 0.35, depthWrite: false }), -0.2, 2.5);
    this.embers = new Emitter(300, new THREE.PointsMaterial({ map: soft, color: 0xff8a30, size: 0.08, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), -1.2, 0.3);
    for (const e of [this.blood, this.sparks, this.dust, this.embers]) this.group.add(e.points);
  }

  addEmberSource(p: THREE.Vector3): void {
    this.emberSources.push(p.clone());
  }

  bleed(at: THREE.Vector3, heavy: boolean, dir: number): void {
    if (!this.bloodOn) {
      this.spark(at, heavy ? 30 : 14);
      return;
    }
    this.blood.spawn(at, heavy ? 70 : 30, [1.5, heavy ? 5 : 3.2], new THREE.Vector3(0.6 + Math.max(0, dir) * 0.8, 0.9, 0.6), [0.6, 1.2], 0.6);
    // pools on the ground
    for (let i = 0; i < (heavy ? 3 : 1); i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(heavy ? 0.45 : 0.28, 16),
        new THREE.MeshBasicMaterial({ map: this.splatTex, transparent: true, depthWrite: false, opacity: 0.9 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI * 2;
      m.position.set(at.x + dir * (0.3 + Math.random() * 0.6), 0.015 + this.decals.length * 0.0005, at.z + (Math.random() - 0.5) * 0.6);
      this.group.add(m);
      this.decals.push({ mesh: m, life: 30 });
    }
  }

  spark(at: THREE.Vector3, n = 22): void {
    this.sparks.spawn(at, n, [2, 6], new THREE.Vector3(1, 1, 1), [0.15, 0.4], 0.3);
  }

  kickDust(at: THREE.Vector3): void {
    this.dust.spawn(at, 10, [0.3, 0.9], new THREE.Vector3(1, 0.2, 1), [0.6, 1.1], 0.4);
  }

  update(dt: number): void {
    this.emberTimer += dt;
    while (this.emberTimer > 0.05 && this.emberSources.length) {
      this.emberTimer -= 0.05;
      for (const s of this.emberSources) this.embers.spawn(s, 1, [0.2, 0.7], new THREE.Vector3(0.3, 1, 0.3), [0.6, 1.4], 2);
    }
    for (const e of [this.blood, this.sparks, this.dust, this.embers]) e.update(dt);
    for (const d of this.decals) {
      d.life -= dt;
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, d.life / 5);
    }
    const dead = this.decals.filter((d) => d.life <= 0);
    for (const d of dead) {
      this.group.remove(d.mesh);
      d.mesh.geometry.dispose();
      (d.mesh.material as THREE.Material).dispose();
    }
    this.decals = this.decals.filter((d) => d.life > 0);
  }
}
