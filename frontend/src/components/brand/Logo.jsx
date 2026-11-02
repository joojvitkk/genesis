import { WORDMARK_D, WORDMARK_W } from './wordmark';

/**
 * Marca GENESIS (conceito 02 · G modular, ver "GENESIS — Identidade visual.html").
 *  - variant="horizontal": símbolo + wordmark (assinatura prioritária)
 *  - variant="symbol": só o quadrado com o G (favicons, avatares)
 *  - variant="wordmark": só o nome (tracking 0,18 em)
 * O quadrado é sempre o vermelho da marca; o wordmark herda a cor do texto (`currentColor`).
 * Área de respeito: X = ¼ da altura do símbolo em volta. Tamanho mínimo: símbolo 16 px · horizontal 124 px de largura.
 */
function SymbolGlyph() {
  return (
    <>
      <rect width="32" height="32" rx="6" fill="var(--brand)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="3.3" />
      <rect x="20.1" y="11.9" width="9" height="8.2" fill="var(--brand)" />
      <path d="M16 16H24.6" stroke="#fff" strokeWidth="3.3" strokeLinecap="square" />
    </>
  );
}

export default function Logo({ variant = 'horizontal', height = 32, className = '', title = 'GENESIS' }) {
  const common = { role: 'img', 'aria-label': title, className, focusable: 'false' };
  if (variant === 'symbol') {
    return <svg {...common} width={height} height={height} viewBox="0 0 32 32"><title>{title}</title><SymbolGlyph /></svg>;
  }
  if (variant === 'wordmark') {
    const h = 21;
    return (
      <svg {...common} width={(height / h) * WORDMARK_W} height={height} viewBox={`0 0 ${WORDMARK_W} ${h}`}>
        <title>{title}</title><path d={WORDMARK_D} fill="currentColor" />
      </svg>
    );
  }
  const w = 45 + WORDMARK_W;
  return (
    <svg {...common} width={(height / 32) * w} height={height} viewBox={`0 8 ${w} 32`}>
      <title>{title}</title>
      <g transform="translate(0 8)"><SymbolGlyph /></g>
      <path transform="translate(45 15.46)" d={WORDMARK_D} fill="currentColor" />
    </svg>
  );
}
