import { tr, getLang } from './translate';

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label'];

function localizeChildren(c) {
  if (typeof c === 'string') return tr(c);
  if (Array.isArray(c)) {
    let changed = false;
    const out = c.map((x) => { const y = localizeChildren(x); if (y !== x) changed = true; return y; });
    return changed ? out : c;
  }
  return c;
}

/** Devolve `props` com os textos traduzidos (cópia só se algo mudou). Em português é a identidade. */
export function localizeProps(props) {
  if (getLang() === 'pt' || !props) return props;
  let next = props;
  const set = (k, v) => { if (next === props) next = { ...props }; next[k] = v; };
  if ('children' in props) { const c = localizeChildren(props.children); if (c !== props.children) set('children', c); }
  for (const a of ATTRS) if (typeof props[a] === 'string') { const v = tr(props[a]); if (v !== props[a]) set(a, v); }
  return next;
}
