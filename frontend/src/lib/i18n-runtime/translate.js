// Tradução de TEXTO DE INTERFACE em tempo de renderização (pt → en). O código-fonte continua em português: todo texto que
// vira filho/`title`/`placeholder`/`aria-label` passa por `tr()` (via o jsx-runtime desta pasta). Dados vindos do servidor
// (nomes de torneio, fichário…) não estão no dicionário e passam intactos.
//
// Dicionário: src/locales/en-ui.js  { 'Texto em português': 'English text' }.
// Texto com valores embutidos usa {} como curinga:  'Total de {} fichas': 'Total of {} chips'  (os {} são copiados na ordem).
import EN from '../../locales/en-ui';

const KEY = 'genesis_lang';
let lang = 'pt';
try { lang = localStorage.getItem(KEY) || 'pt'; } catch { /* sem storage */ }

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const exact = new Map();
const patterns = [];
for (const [pt, en] of Object.entries(EN)) {
  const k = norm(pt);
  if (k.includes('{}')) {
    const src = k.split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
    patterns.push({ re: new RegExp(`^${src}$`), en });
  } else exact.set(k, en);
}
// padrões mais específicos (mais texto fixo) primeiro
patterns.sort((a, b) => b.re.source.length - a.re.source.length);

export const getLang = () => lang;
export const setRuntimeLang = (l) => { lang = l; };
/** Locale de números/datas conforme o idioma. */
export const locale = () => (lang === 'en' ? 'en-US' : 'pt-BR');

export function tr(value) {
  if (lang === 'pt' || typeof value !== 'string' || value === '') return value;
  const lead = value.match(/^\s*/)[0];
  const trail = value.match(/\s*$/)[0];
  const k = norm(value);
  if (!k) return value;
  const hit = exact.get(k);
  if (hit !== undefined) return lead + hit + trail;
  for (const p of patterns) {
    const m = k.match(p.re);
    if (m) { let i = 0; return lead + p.en.replace(/\{\}/g, () => tr(m[++i] ?? '')) + trail; }
  }
  return value;
}
