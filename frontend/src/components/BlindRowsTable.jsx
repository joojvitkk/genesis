import { Coffee, Trash2 } from 'lucide-react';
import { levelNumberAt } from '../lib/blinds';

const BREAK_DURATIONS = [10, 15, 20, 30, 45, 60, 90];

/**
 * Tabela editável da estrutura de blinds — usada na Logística (torneio) e na Tracking Sheet (template).
 * Controlada: o pai guarda as linhas. `onCell(idx, field, value)` edita; `onRemove(idx)` exclui. `readOnly` só consulta.
 */
export default function BlindRowsTable({ rows = [], onCell, onRemove, readOnly = false }) {
  const cell = 'input !min-h-8 w-20 px-2 py-1 text-sm';
  const trash = (idx) => !readOnly && (
    <button type="button" onClick={() => onRemove(idx)} aria-label="Remover linha" className="btn btn-ghost btn-icon hover:!text-danger"><Trash2 size={16} /></button>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="blind-rows">
        <thead>
          <tr className="border-b border-line-soft text-fg-subtle">
            <th className="py-3 pr-4 font-semibold">Nível</th>
            <th className="px-2 font-semibold">SB</th>
            <th className="px-2 font-semibold">BB</th>
            <th className="px-2 font-semibold">Ante</th>
            <th className="px-2 font-semibold">Min</th>
            {!readOnly && <th className="pl-4 text-right font-semibold"><span className="sr-only">Ação</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            if (row.row_type === 'end_registration' || row.row_type === 'end_day') {
              return (
                <tr key={idx} className="border-b border-line-soft">
                  <td colSpan={5} className="py-2 pr-4"><span className="badge badge-info">{row.label}</span></td>
                  {!readOnly && <td className="py-2 pl-4 text-right">{trash(idx)}</td>}
                </tr>
              );
            }
            if (row.row_type === 'break') {
              return (
                <tr key={idx} className="border-b border-line-soft bg-warn-soft/40">
                  <td className="py-2 pr-4"><span className="badge badge-warn"><Coffee size={14} aria-hidden="true" /> {row.label || 'Intervalo'}</span></td>
                  <td colSpan={3} className="px-2 py-2 text-fg-subtle">—</td>
                  <td className="px-2 py-2">
                    {readOnly ? <span>{row.duration} min</span> : (
                      <select aria-label="Duração do intervalo" value={row.duration} onChange={(e) => onCell(idx, 'duration', e.target.value)} className="input !min-h-8 w-24 px-2 py-1 text-sm">
                        {[...new Set([...BREAK_DURATIONS, Number(row.duration)])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} min</option>)}
                      </select>
                    )}
                  </td>
                  {!readOnly && <td className="py-2 pl-4 text-right">{trash(idx)}</td>}
                </tr>
              );
            }
            const num = levelNumberAt(rows, idx);
            const field = (name, w) => (readOnly
              ? <span>{row[name]}</span>
              : <input type="number" min="0" aria-label={`${name} nível ${num}`} value={row[name] ?? ''} onChange={(e) => onCell(idx, name, e.target.value)} className={`${cell} ${w || ''}`} />);
            return (
              <tr key={idx} className="border-b border-line-soft hover:bg-sunken/50">
                <td className="py-2 pr-4 font-semibold text-fg-muted">{num}</td>
                <td className="px-2 py-2">{field('small_blind')}</td>
                <td className="px-2 py-2">{field('big_blind')}</td>
                <td className="px-2 py-2">{field('ante')}</td>
                <td className="px-2 py-2">{field('duration')}</td>
                {!readOnly && <td className="py-2 pl-4 text-right">{trash(idx)}</td>}
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="py-6 text-center text-fg-subtle">Nenhum nível cadastrado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

