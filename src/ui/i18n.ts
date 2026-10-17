// Interface language. English text is the key; other languages map it to a translation, and anything
// untranslated falls back to English. `{name}` placeholders are filled from `vars`.
import { EL } from './i18n_el';

export type Lang = 'en' | 'el';

let lang: Lang = 'en';
const listeners: (() => void)[] = [];

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  for (const f of listeners) f();
}

export function getLang(): Lang {
  return lang;
}

export function onLang(f: () => void): void {
  listeners.push(f);
}

function fill(s: string, vars?: Record<string, string | number>): string {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : s;
}

/** Translate an English UI string. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(lang === 'el' ? EL.ui[en] ?? en : en, vars);
}

/** Translate a proper name from the data files (places, monsters, items, boons, scars, events). */
export function tn(en: string): string {
  return lang === 'el' ? EL.names[en] ?? en : en;
}

/** Translate a descriptive line from the data files (item descriptions, monster hints, event text). */
export function td(en: string): string {
  return lang === 'el' ? EL.desc[en] ?? en : en;
}

// Chronicle lines are produced in English by the rules engine; they are matched against templates here.
type LogRule = [RegExp, string];
let logRules: LogRule[] | null = null;

/** Translate a chronicle line by template (names inside are translated too). */
export function tlog(en: string): string {
  if (lang !== 'el') return en;
  return matchLog(en) ?? splitLog(en) ?? en;
}

function rules(): LogRule[] {
  if (!logRules) {
    logRules = EL.log.map(([pat, out]) => {
      const rx = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '(.+?)');
      return [new RegExp(`^${rx}$`), out] as LogRule;
    });
  }
  return logRules;
}

/** One whole line against the templates; placeholder values are looked up (or matched again) in turn. */
function matchLog(en: string): string | null {
  for (const [rx, out] of rules()) {
    const m = en.match(rx);
    if (m) {
      let i = 0;
      // `{b_acc}` in a translation asks for a grammatical case of a data name (names key `acc:<English>`)
      return out.replace(/\{\w+?(?:_(\w+))?\}/g, (_, form?: string) => {
        const v = m[++i] ?? '';
        return (form ? EL.names[`${form}:${v}`] : undefined) ?? EL.names[v] ?? EL.desc[v] ?? (v.length < en.length ? matchLog(v) ?? splitLog(v) : null) ?? v;
      });
    }
  }
  return null;
}

/** Lines glued from several sentences (deaths, loot) are translated sentence by sentence. */
function splitLog(en: string): string | null {
  const parts = en.split(/(?<=[.!?])\s+/);
  if (parts.length < 2) return null;
  let hit = false;
  const out = parts.map((p) => {
    const r = matchLog(p);
    if (r !== null) hit = true;
    return r ?? p;
  });
  return hit ? out.join(' ') : null;
}
