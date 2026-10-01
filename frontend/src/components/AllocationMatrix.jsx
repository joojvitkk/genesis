// Matriz ficha × torneio de UM fichário (G5): saldo físico, quanto está alocado a cada torneio e o LIVRE.
// Os números vêm do servidor (GET /allocations/matrix); aqui só exibimos.
const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');
const STATUS = { planned: 'planejada', active: 'ativa' };

/**
 * props: matrix { binder, chips: [{ chip, balance, allocated: [{allocation_id, tournament_name, status, quantity}], allocated_total, free }] }
 *        ownAllocationId — ignora esta alocação ao calcular o livre (edição)
 *        renderControl(row, freeForMe) — coluna extra opcional (checkbox, campo de quantidade…)
 *        controlLabel — título da coluna extra
 */
export default function AllocationMatrix({ matrix, ownAllocationId, renderControl, controlLabel }) {
  if (!matrix) return null;
  if (matrix.chips.length === 0) return <p className="py-6 text-center text-sm italic text-gray-400">Este fichário não tem fichas (monte-o antes de alocar).</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-gray-400">
            <th className="py-2 pr-3 text-left font-black">Ficha</th>
            <th className="px-2 py-2 text-right font-black">Saldo</th>
            <th className="px-2 py-2 text-left font-black">Alocado a</th>
            <th className="px-2 py-2 text-right font-black">Livre</th>
            {renderControl && <th className="px-2 py-2 text-center font-black">{controlLabel}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
          {matrix.chips.map((row) => {
            const others = row.allocated.filter((a) => a.allocation_id !== ownAllocationId);
            const freeForMe = row.balance - others.reduce((s, a) => s + a.quantity, 0);
            return (
              <tr key={row.chip._id}>
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2 font-bold text-gray-700 dark:text-gray-300">
                    <span className="h-3 w-3 rounded-full border border-gray-200 dark:border-zinc-700" style={{ backgroundColor: row.chip.color }} />
                    {fmt(row.chip.value)}
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-600 dark:text-gray-400">{fmt(row.balance)}</td>
                <td className="px-2 py-2 text-xs">
                  {row.allocated.length === 0 ? <span className="text-gray-300 dark:text-zinc-700">—</span> : row.allocated.map((a) => (
                    <span key={a.allocation_id} className={`mr-1 inline-block rounded-md px-1.5 py-0.5 font-bold ${a.allocation_id === ownAllocationId ? 'bg-red-50 text-genesis-red dark:bg-red-500/10' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`} title={STATUS[a.status]}>
                      {a.tournament_name || 'torneio'}: {fmt(a.quantity)}
                    </span>
                  ))}
                </td>
                <td className={`px-2 py-2 text-right font-black tabular-nums ${freeForMe < 0 ? 'text-red-500' : freeForMe === 0 ? 'text-gray-400' : 'text-emerald-600 dark:text-emerald-500'}`}
                  title={freeForMe < 0 ? 'Falta: o saldo caiu abaixo do alocado' : undefined}>
                  {fmt(row.free)}
                </td>
                {renderControl && <td className="px-2 py-2 text-center">{renderControl(row, freeForMe)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
