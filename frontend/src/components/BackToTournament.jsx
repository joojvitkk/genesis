import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * "← Voltar ao torneio": reabre o ponto de origem (torneio, aba e sessão). Se a tela foi aberta a partir do torneio, volta
 * pelo histórico; caso contrário (link direto, atualização da página) vai para o endereço do torneio.
 */
export default function BackToTournament({ tournamentId, sessionId, tab = 'salao', className = '' }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!tournamentId) return null;
  const href = `/torneios/${tournamentId}/${tab}${sessionId ? `?sessao=${sessionId}` : ''}`;
  const go = () => (location.key !== 'default' ? navigate(-1) : navigate(href));
  return (
    <a href={href} onClick={(e) => { e.preventDefault(); go(); }} className={`inline-flex items-center gap-1 text-xs font-bold text-brand-fg ${className}`}>
      <ArrowLeft size={12} /> Voltar ao torneio
    </a>
  );
}
