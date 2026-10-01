import { useRef } from 'react';
import { Check, Palette } from 'lucide-react';

// Paleta no estilo Excel: colunas de cores × tons (do claro ao escuro) + cores padrão + "Personalizar cor".
// Quem cadastra escolhe a cor CLICANDO — ninguém precisa digitar hexadecimal (o valor é guardado como #rrggbb).
function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const HUES = [
  ['Vermelho', 0], ['Laranja', 28], ['Amarelo', 50], ['Verde', 120], ['Turquesa', 170], ['Azul', 210], ['Roxo', 270], ['Rosa', 320], ['Marrom', 25],
];
const TONE_LIGHTNESS = [88, 74, 58, 42, 28]; // do mais claro ao mais escuro
const GRAYS = ['#ffffff', '#e5e5e5', '#a3a3a3', '#525252', '#000000'];

/** [{ name, colors: [hex × 5] }] — a primeira coluna são os cinzas (branco → preto). */
export const PALETTE = [
  { name: 'Cinza', colors: GRAYS },
  ...HUES.map(([name, h]) => ({
    name,
    colors: TONE_LIGHTNESS.map((l) => (name === 'Marrom' ? hsl(h, 45, l * 0.8) : hsl(h, 75, l))),
  })),
];
export const STANDARD = [
  ['Vermelho escuro', '#c00000'], ['Vermelho', '#ff0000'], ['Laranja', '#ffc000'], ['Amarelo', '#ffff00'], ['Verde claro', '#92d050'],
  ['Verde', '#00b050'], ['Azul claro', '#00b0f0'], ['Azul', '#0070c0'], ['Azul escuro', '#002060'], ['Roxo', '#7030a0'],
];
const TONE_NAMES = ['muito claro', 'claro', 'médio', 'escuro', 'muito escuro'];

const norm = (c) => String(c || '').toLowerCase();
const inPalette = (c) => PALETTE.some((col) => col.colors.includes(norm(c))) || STANDARD.some(([, hex]) => hex === norm(c));

/**
 * Seletor de cor. `value` = #rrggbb; `onChange(hex)`.
 * Escolha na grade (cores × tons), nas cores padrão, ou em "Personalizar cor" (seletor visual do navegador).
 */
export default function ColorPicker({ value, onChange }) {
  const custom = useRef(null);
  const current = norm(value);
  const Swatch = ({ hex, label }) => {
    const selected = current === hex;
    return (
      <button
        type="button" onClick={() => onChange(hex)} aria-label={label} aria-pressed={selected} title={label} data-color={hex}
        className={`relative h-7 w-7 rounded-md border transition-transform hover:scale-110 ${selected ? 'border-genesis-red ring-2 ring-genesis-red' : 'border-gray-300 dark:border-zinc-600'}`}
        style={{ backgroundColor: hex }}
      >
        {selected && <Check size={14} className="absolute inset-0 m-auto drop-shadow" style={{ color: /^#(?:f|e|d|c|b|a|9)/.test(hex) && hex !== '#ff0000' ? '#000' : '#fff' }} />}
      </button>
    );
  };

  return (
    <div data-testid="color-picker" className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-[#111111]">
      <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
        <span data-testid="color-current" className="h-6 w-6 rounded-md border border-gray-300 dark:border-zinc-600" style={{ backgroundColor: current || 'transparent' }} />
        {current ? (inPalette(current) ? 'Cor selecionada' : 'Cor personalizada') : 'Escolha uma cor'}
      </div>

      <div>
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Cores do tema</p>
        <div className="grid grid-cols-10 gap-x-1.5" role="group" aria-label="Cores do tema">
          {PALETTE.map((col) => (
            <div key={col.name} className="flex flex-col gap-1.5">
              {col.colors.map((hex, i) => <Swatch key={hex} hex={hex} label={`${col.name} — ${col.name === 'Cinza' ? ['branco', 'cinza claro', 'cinza', 'cinza escuro', 'preto'][i] : TONE_NAMES[i]}`} />)}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Cores padrão</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cores padrão">
          {STANDARD.map(([name, hex]) => <Swatch key={hex} hex={hex} label={name} />)}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button" onClick={() => custom.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:border-genesis-red hover:text-genesis-red dark:border-zinc-600 dark:bg-zinc-800 dark:text-gray-200"
        >
          <Palette size={14} /> Personalizar cor…
        </button>
        <input ref={custom} type="color" aria-label="Cor personalizada" value={/^#[0-9a-f]{6}$/.test(current) ? current : '#888888'}
          onChange={(e) => onChange(norm(e.target.value))} className="h-0 w-0 opacity-0" tabIndex={-1} />
      </div>
    </div>
  );
}
