// Helpers puros da estrutura de blinds (Logística e Tracking Sheet). Linhas: { row_type, small_blind, big_blind, ante, duration, label }.
// Breaks/Dinner Breaks e marcadores NÃO contam como nível. Nada aqui gera blinds por fórmula.

export const DEFAULT_LEVEL = { small_blind: 50, big_blind: 100, ante: 0, duration: 20 };

export const isLevelRow = (r) => !r?.row_type || r.row_type === 'level';

/** Número do nível exibido na linha `idx` (só linhas `level` contam), ou null se não for um nível. */
export function levelNumberAt(rows, idx) {
  if (!isLevelRow(rows[idx])) return null;
  return rows.slice(0, idx + 1).filter(isLevelRow).length;
}

/** Novo nível: numeração seguinte e valores do ÚLTIMO nível configurado (editáveis). Nunca dobra nem volta ao Nível 1. */
export function nextLevelRow(rows) {
  const levels = rows.filter(isLevelRow);
  const last = levels[levels.length - 1] || DEFAULT_LEVEL;
  return { row_type: 'level', level: levels.length + 1, small_blind: last.small_blind, big_blind: last.big_blind, ante: last.ante || 0, duration: last.duration };
}

/** Break (ou Dinner Break) com duração própria; não incrementa o número do nível. */
export const breakRow = (minutes, dinner = false) => ({ row_type: 'break', duration: minutes, label: dinner ? `Dinner Break ${minutes} min` : `Break ${minutes} min` });

/** Remove campos internos (_id) para copiar a estrutura por valor para outro documento. */
export const cloneRows = (rows = []) => rows.map(({ _id: _omit, ...r }) => ({ ...r }));

/** Mensagem de erro (ou null) para salvar: ao menos 1 nível; SB/BB/duração positivos. */
export function validateRows(rows) {
  const levels = rows.filter(isLevelRow);
  if (!levels.length) return 'Adicione ao menos um nível.';
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (isLevelRow(r) && (!(Number(r.small_blind) > 0) || !(Number(r.big_blind) > 0))) return `Nível ${levelNumberAt(rows, i)}: SB e BB devem ser maiores que zero.`;
    if ((isLevelRow(r) || r.row_type === 'break') && !(Number(r.duration) > 0)) return 'Toda duração deve ser maior que zero.';
  }
  return null;
}

/** Duração total (min) da estrutura. */
export const totalMinutes = (rows) => rows.reduce((s, r) => s + (isLevelRow(r) || r.row_type === 'break' ? Number(r.duration) || 0 : 0), 0);
