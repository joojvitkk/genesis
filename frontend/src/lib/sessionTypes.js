// Tipos de sessão: Classificatória e Dia Único têm fichas próprias; Continuação e Dia Final herdam das origens.
export const isInheritingSession = (s) => !!s && (s.type === 'CONTINUATION' || s.type === 'FINAL');
export const hasQualified = (s) => !!s && (s.type === 'QUALIFIER' || s.type === 'CONTINUATION');
export const SESSION_TYPE_LABELS = [['QUALIFIER', 'Classificatória'], ['SINGLE', 'Dia Único'], ['CONTINUATION', 'Continuação (Dia 2, 3…)'], ['FINAL', 'Dia Final']];
