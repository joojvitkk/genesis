import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';

/**
 * Autocomplete de jogador. Busca em /players e permite cadastrar um novo na hora.
 * props: value (player object | null), onChange(player | null), placeholder, disabled
 */
export default function PlayerSelect({ value, onChange, placeholder = 'Buscar jogador…', disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = setTimeout(async () => {
      try { setResults(await apiGet('/players', { search: q, limit: 8 })); } catch { /* silencioso */ }
    }, 220);
    return () => clearTimeout(h);
  }, [q, open]);

  const pick = (p) => { onChange(p); setOpen(false); setQ(''); };

  const createNew = async () => {
    if (!q.trim() || creating) return;
    setCreating(true);
    try {
      pick(await apiPost('/players', { name: q.trim() }));
    } catch { /* toast é da página */ }
    finally { setCreating(false); }
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-[#141414]">
        <span className="truncate font-bold text-gray-900 dark:text-white">
          {value.name}{value.document ? <span className="ml-2 text-xs font-normal text-gray-400">{value.document}</span> : null}
        </span>
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} className="text-gray-400 hover:text-red-500">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm focus-within:border-genesis-red dark:border-zinc-700 dark:bg-[#141414]">
        <Search size={16} className="shrink-0 text-gray-400" />
        <input
          type="text"
          value={q}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          placeholder={placeholder}
          className="w-full bg-transparent font-bold outline-none dark:text-white"
        />
      </div>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-[#141414]">
          {results.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => pick(p)}
              className="flex w-full items-center justify-between border-b border-gray-50 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-gray-50 dark:border-zinc-800/40 dark:hover:bg-zinc-800/50"
            >
              <span className="font-bold text-gray-900 dark:text-white">{p.name}</span>
              {p.document && <span className="text-xs text-gray-400">{p.document}</span>}
            </button>
          ))}
          {q.trim() && !results.some((p) => p.name.toLowerCase() === q.trim().toLowerCase()) && (
            <button
              type="button"
              onClick={createNew}
              disabled={creating}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold text-genesis-red hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
            >
              <UserPlus size={15} /> Cadastrar "{q.trim()}"
            </button>
          )}
          {!q.trim() && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">Digite para buscar…</p>
          )}
        </div>
      )}
    </div>
  );
}
