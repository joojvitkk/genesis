// Semáforo (spec §11): verde / amarelo / vermelho. A cor NUNCA é o único sinal — sempre vem com o texto.
export const SEVERITY = {
  GREEN: { label: 'Verde', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', dot: 'bg-emerald-500' },
  YELLOW: { label: 'Amarelo', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400', dot: 'bg-amber-400' },
  RED: { label: 'Vermelho', cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400', dot: 'bg-red-500' },
};

export default function SeverityBadge({ level }) {
  const s = SEVERITY[level] || SEVERITY.GREEN;
  return (
    <span data-severity={level} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wide ${s.cls}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}
