// Poly Haven pipeline (CC0 textures, HDRIs, models), run by .github/workflows/polyhaven.yml on GitHub's servers.
//   scout: list candidate assets per category with thumbnails -> tools/polyhaven/candidates.json + thumbs/
//   fetch: download the picks in tools/polyhaven/picks.json -> public/assets/ph/
//          textures: 1k diffuse/normal/roughness as webp; hdri: 1k .hdr; models: 1k glTF packed + compressed to .glb
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const API = 'https://api.polyhaven.com';
const DIR = 'tools/polyhaven';
const OUT = 'public/assets/ph';
const HEADERS = { 'User-Agent': 'moonblood-asset-pipeline/1.0 (github actions)' };

async function getJson(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  throw new Error(`failed ${url}`);
}

async function getBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  throw new Error(`failed ${url}`);
}

/** [group, asset type, required tag/category words (any)] */
const SCOUT: [string, string, string[]][] = [
  ['ground', 'textures', ['grass', 'forest ground', 'forrest', 'leaves', 'moss']],
  ['dirt', 'textures', ['dirt', 'mud', 'soil', 'path', 'gravel']],
  ['rock', 'textures', ['rock', 'cliff', 'stone']],
  ['hdri', 'hdris', ['night', 'moon', 'dusk']],
  ['trees', 'models', ['tree', 'pine', 'fir', 'shrub', 'bush']],
  ['rocks', 'models', ['rock', 'boulder', 'stone']],
  ['props', 'models', ['barrel', 'crate', 'lantern', 'cart', 'fence', 'ruin', 'wall', 'stump', 'log']],
];

async function scout(): Promise<void> {
  mkdirSync(join(DIR, 'thumbs'), { recursive: true });
  const out: Record<string, { id: string; name: string; tags: string[]; downloads: number }[]> = {};
  for (const [group, type, words] of SCOUT) {
    const all = await getJson(`${API}/assets?t=${type}`) as Record<string, any>;
    const hits = Object.entries(all)
      .filter(([id, a]) => {
        const hay = `${id} ${a.name} ${(a.tags ?? []).join(' ')} ${(a.categories ?? []).join(' ')}`.toLowerCase();
        return words.some((w) => hay.includes(w));
      })
      .map(([id, a]) => ({ id, name: a.name as string, tags: (a.tags ?? []) as string[], downloads: (a.download_count ?? 0) as number }))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, group === 'props' ? 24 : 16);
    for (const [i, h] of hits.entries()) {
      try {
        writeFileSync(join(DIR, 'thumbs', `${group}_${i}_${h.id}.png`), await getBytes(`https://cdn.polyhaven.com/asset_img/thumbs/${h.id}.png?width=256&height=256`));
      } catch (e) { console.warn(String(e)); }
    }
    out[group] = hits;
    console.log(`${group}: ${hits.length}`);
  }
  writeFileSync(join(DIR, 'candidates.json'), JSON.stringify(out, null, 2));
}

interface Picks { textures?: Record<string, string>; hdri?: Record<string, string>; models?: Record<string, string | { id: string; tris?: number }> }

async function fetchPicks(): Promise<void> {
  const picks = JSON.parse(readFileSync(join(DIR, 'picks.json'), 'utf8')) as Picks;
  // `fetch <name,name>` refreshes only those models
  const only = process.argv[3]?.split(',');
  if (only) { picks.textures = {}; picks.hdri = {}; picks.models = Object.fromEntries(Object.entries(picks.models ?? {}).filter(([k]) => only.includes(k))); }
  mkdirSync(OUT, { recursive: true });
  const sharp = (await import('sharp')).default;
  const credits: string[] = [];
  // textures: name -> polyhaven id; each becomes <name>_diff.webp, <name>_nor.webp, <name>_rough.webp
  for (const [name, id] of Object.entries(picks.textures ?? {})) {
    const files = await getJson(`${API}/files/${id}`);
    const maps: [string, string[]][] = [['diff', ['Diffuse', 'diff']], ['nor', ['nor_gl']], ['rough', ['Rough', 'rough']]];
    for (const [suffix, keys] of maps) {
      const key = keys.find((k) => files[k]);
      if (!key) { console.warn(`${id}: no ${suffix}`); continue; }
      const src = files[key]['1k']?.jpg?.url ?? files[key]['1k']?.png?.url;
      const bytes = await getBytes(src);
      await sharp(bytes).resize(1024, 1024).webp({ quality: suffix === 'diff' ? 82 : 88 }).toFile(join(OUT, `${name}_${suffix}.webp`));
    }
    credits.push(`- texture **${name}**: Poly Haven "${id}" (CC0) - https://polyhaven.com/a/${id}`);
    console.log(`texture ${name} <- ${id}`);
  }
  for (const [name, id] of Object.entries(picks.hdri ?? {})) {
    const files = await getJson(`${API}/files/${id}`);
    writeFileSync(join(OUT, `${name}.hdr`), await getBytes(files.hdri['1k'].hdr.url));
    credits.push(`- HDRI **${name}**: Poly Haven "${id}" (CC0) - https://polyhaven.com/a/${id}`);
    console.log(`hdri ${name} <- ${id}`);
  }
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await MeshoptSimplifier.ready;
  for (const [name, pick] of Object.entries(picks.models ?? {})) {
    const id = typeof pick === 'string' ? pick : pick.id;
    const target = typeof pick === 'string' ? 12000 : pick.tris ?? 12000;
    const files = await getJson(`${API}/files/${id}`);
    const g = files.gltf['1k'].gltf;
    const json = JSON.parse(new TextDecoder().decode(await getBytes(g.url)));
    const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (const [path, inc] of Object.entries(g.include ?? {})) resources[path] = await getBytes((inc as { url: string }).url);
    // foliage: Poly Haven ships the leaf cut-out as a separate <part>_alpha map; fold it into the colour
    // texture's alpha channel so the leaves render as alpha-tested cards
    for (const mat of json.materials ?? []) {
      if (mat.alphaMode !== 'BLEND' && mat.alphaMode !== 'MASK') continue;
      const tex = json.textures?.[mat.pbrMetallicRoughness?.baseColorTexture?.index];
      const uri: string | undefined = tex !== undefined ? json.images?.[tex.source]?.uri : undefined;
      const part = uri?.match(new RegExp(`${id}_(.+)_diff`))?.[1];
      const alpha = part ? files[`${part}_alpha`]?.['1k'] : null;
      const aurl = alpha?.png?.url ?? alpha?.jpg?.url;
      if (!uri || !aurl) { console.warn(`  ${id}: no alpha map for ${mat.name}`); continue; }
      const a = await sharp(await getBytes(aurl)).greyscale().resize(1024, 1024).raw().toBuffer();
      const rgba = await sharp(resources[uri]).resize(1024, 1024).joinChannel(a, { raw: { width: 1024, height: 1024, channels: 1 } }).png().toBuffer();
      const png = uri.replace(/\.jpg$/, '.png');
      resources[png] = new Uint8Array(rgba);
      json.images[tex.source].uri = png;
      json.images[tex.source].mimeType = 'image/png';
      mat.alphaMode = 'MASK';
      mat.alphaCutoff = 0.4;
      mat.doubleSided = true;
      console.log(`  ${id}: merged ${part}_alpha`);
    }
    const doc = await io.readJSON({ json, resources });
    // scanned models are dense: simplify toward a triangle budget so dozens can be instanced
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
    const ratio = Math.min(1, target / Math.max(1, tris));
    await doc.transform(dedup(), weld());
    if (ratio < 0.95) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
    console.log(`  ${id}: ${Math.round(tris)} tris -> ratio ${ratio.toFixed(3)}`);
    await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const bytes = await io.writeBinary(doc);
    writeFileSync(join(OUT, `${name}.glb`), bytes);
    credits.push(`- model **${name}**: Poly Haven "${id}" (CC0) - https://polyhaven.com/a/${id}`);
    console.log(`model ${name} <- ${id}: ${(bytes.length / 1024).toFixed(0)} KB`);
  }
  if (!only) writeFileSync(join(OUT, 'CREDITS.md'), `# Poly Haven assets (CC0)\n\n${credits.join('\n')}\n`);
}

/** Dump the file listing of a few assets (to inspect how Poly Haven packages them). */
async function probe(): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const id of ['fir_tree_01', 'tree_small_02']) {
    const files = await getJson(`${API}/files/${id}`);
    const g = files.gltf?.['1k']?.gltf;
    out[id] = { keys: Object.keys(files), gltfInclude: g ? Object.keys(g.include ?? {}) : null };
    if (g) {
      const json = JSON.parse(new TextDecoder().decode(await getBytes(g.url)));
      out[`${id}_materials`] = json.materials;
      out[`${id}_images`] = json.images;
    }
  }
  writeFileSync(join(DIR, 'probe.json'), JSON.stringify(out, null, 2));
}

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
(process.argv[2] === 'fetch' ? fetchPicks() : process.argv[2] === 'probe' ? probe() : scout()).catch((e) => {
  console.error(e);
  process.exit(1);
});
