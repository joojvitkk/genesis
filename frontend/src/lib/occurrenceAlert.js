// Texto do alerta urgente de ocorrência (spec §11): só as VERMELHAS interrompem todo mundo.
export function occurrenceAlertText(o) {
  if (o?.severity !== 'RED') return null;
  const where = o.binder_name ? `fichário ${o.binder_name}` : o.tournament_name ? `torneio ${o.tournament_name}` : '';
  return `${o.kind === 'LOSS' ? 'Falta' : 'Sobra'} de ${o.quantity} × ${o.chip?.name || 'ficha'}${where ? ` (${where})` : ''}`;
}
