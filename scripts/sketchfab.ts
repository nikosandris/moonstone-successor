// Sketchfab pipeline, run by .github/workflows/sketchfab.yml on GitHub's servers (which can reach Sketchfab).
//   scout: search for downloadable, animated, rigged, freely licensed models per role; save metadata + thumbnails.
//   fetch: download the chosen models (needs the SKETCHFAB_TOKEN secret), convert to optimised .glb, write credits.
// Choices live in tools/sketchfab/roles.json (queries) and tools/sketchfab/picks.json (role -> model uid).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const API = 'https://api.sketchfab.com/v3';
const DIR = 'tools/sketchfab';
const OUT = 'public/assets/sf';
const LICENSES = ['cc0', 'by'];

interface Role { role: string; queries: string[]; maxFaces?: number; static?: boolean }
interface Hit {
  uid: string; name: string; author: string; license: string; faces: number; animations: number; likes: number;
  url: string; thumb: string; query: string;
}

async function getJson(url: string, token?: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: token ? { Authorization: `Token ${token}` } : {} });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** i)); continue; }
    throw new Error(`${res.status} ${url}: ${await res.text()}`);
  }
  throw new Error(`failed ${url}`);
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function scout(): Promise<void> {
  const roles = JSON.parse(readFileSync(join(DIR, 'roles.json'), 'utf8')) as Role[];
  const only = process.argv[3]?.split(',');
  const prev = existsSync(join(DIR, 'candidates.json')) ? JSON.parse(readFileSync(join(DIR, 'candidates.json'), 'utf8')) : {};
  const out: Record<string, Hit[]> = only ? prev : {};
  mkdirSync(join(DIR, 'thumbs'), { recursive: true });
  for (const r of roles) {
    if (only && !only.includes(r.role)) continue;
    const seen = new Map<string, Hit>();
    for (const q of r.queries) {
      for (const lic of LICENSES) {
        const params = new URLSearchParams({
          type: 'models', q, downloadable: 'true', license: lic,
          sort_by: '-likeCount', count: '24', max_face_count: String(r.maxFaces ?? 80000),
        });
        if (!r.static) { params.set('animated', 'true'); params.set('rigged', 'true'); }
        let data: any;
        try { data = await getJson(`${API}/search?${params}`); } catch (e) { console.warn(String(e)); continue; }
        for (const m of data.results ?? []) {
          if (seen.has(m.uid)) continue;
          const imgs = (m.thumbnails?.images ?? []).sort((a: any, b: any) => Math.abs(a.width - 480) - Math.abs(b.width - 480));
          seen.set(m.uid, {
            uid: m.uid, name: m.name, author: m.user?.displayName ?? m.user?.username ?? '?', license: m.license?.slug ?? lic,
            faces: m.faceCount ?? 0, animations: m.animationCount ?? 0, likes: m.likeCount ?? 0,
            url: m.viewerUrl ?? `https://sketchfab.com/3d-models/${m.uid}`, thumb: imgs[0]?.url ?? '', query: q,
          });
        }
      }
    }
    const hits = [...seen.values()].filter((h) => r.static || h.animations > 0).sort((a, b) => b.likes - a.likes).slice(0, 12);
    for (const [i, h] of hits.entries()) {
      if (!h.thumb) continue;
      try { await download(h.thumb, join(DIR, 'thumbs', `${r.role}_${i}_${h.uid}.jpg`)); } catch (e) { console.warn(String(e)); }
    }
    out[r.role] = hits;
    console.log(`${r.role}: ${hits.length} candidates`);
  }
  writeFileSync(join(DIR, 'candidates.json'), JSON.stringify(out, null, 2));
}

function findFile(dir: string, pred: (f: string) => boolean): string | null {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      const r = findFile(p, pred);
      if (r) return r;
    } else if (pred(f)) return p;
  }
  return null;
}

async function fetchPicks(): Promise<void> {
  const token = process.env.SKETCHFAB_TOKEN;
  if (!token) throw new Error('SKETCHFAB_TOKEN secret is missing');
  const only = process.argv[3]?.split(',');
  const picks = JSON.parse(readFileSync(join(DIR, 'picks.json'), 'utf8')) as Record<string, string>;
  mkdirSync(OUT, { recursive: true });
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const sharp = (await import('sharp')).default;
  const failed: string[] = [];
  for (const [role, uid] of Object.entries(picks)) {
    if (only && !only.includes(role)) continue;
    try {
      await fetchOne(role, uid, token, io, sharp);
    } catch (e) {
      console.error(`${role} (${uid}) failed: ${String(e)}`);
      failed.push(role);
    }
  }
  // credits for every model present, including ones fetched by earlier runs
  const credits = readdirSync(OUT).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const m = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
    return `- **${f.replace('.json', '')}**: "${m.name}" by ${m.author} (${m.license}) - ${m.url}`;
  });
  writeFileSync(join(OUT, 'CREDITS.md'), `# Sketchfab models\n\n${credits.join('\n')}\n`);
  if (failed.length) console.log(`failed: ${failed.join(', ')}`);
}

async function fetchOne(role: string, uid: string, token: string, io: NodeIO, sharp: any): Promise<void> {
  const info = await getJson(`${API}/models/${uid}`);
  const dl = await getJson(`${API}/models/${uid}/download`, token);
  const tmp = join('/tmp', `sf_${uid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let doc;
  if (dl.glb?.url) {
    await download(dl.glb.url, join(tmp, 'm.glb'));
    doc = await io.read(join(tmp, 'm.glb'));
  } else {
    await download(dl.gltf.url, join(tmp, 'm.zip'));
    execFileSync('unzip', ['-q', '-o', join(tmp, 'm.zip'), '-d', tmp]);
    const gltf = findFile(tmp, (f) => f.endsWith('.gltf') || f.endsWith('.glb'));
    if (!gltf) throw new Error(`no gltf in ${uid}`);
    doc = await io.read(gltf);
  }
  await doc.transform(
    dedup(), resample(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const bytes = await io.writeBinary(doc);
  writeFileSync(join(OUT, `${role}.glb`), bytes);
  const clips = doc.getRoot().listAnimations().map((a) => a.getName());
  writeFileSync(join(OUT, `${role}.json`), JSON.stringify({ uid, name: info.name, author: info.user?.displayName, license: info.license?.label, url: info.viewerUrl, clips }, null, 2));
  console.log(`${role}: ${(bytes.length / 1024).toFixed(0)} KB, clips: ${clips.join(', ')}`);
}

const mode = process.argv[2];
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
(mode === 'fetch' ? fetchPicks() : scout()).catch((e) => {
  console.error(e);
  process.exit(1);
});
