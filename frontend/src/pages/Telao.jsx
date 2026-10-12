import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { Maximize2, ArrowLeft } from 'lucide-react';
import TournamentClock from '../components/TournamentClock';
import { apiGet } from '../lib/api';

/**
 * Tela de projeção — para abrir na TV do salão. Sem sidebar, fundo escuro.
 */
export default function Telao() {
  const { id } = useParams();
  const [name, setName] = useState('');
  const [sessions, setSessions] = useState([]); // cada sessão (Dia 1A, 1B…) tem o seu relógio: a TV mostra UMA por vez
  const [params, setParams] = useSearchParams();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiGet(`/tournaments/${id}`)
      .then((t) => setName(t.name))
      .catch((e) => { if (e.status === 404) setNotFound(true); });
    apiGet(`/tournaments/${id}/sessions`)
      .then((list) => setSessions((list || []).filter((x) => x.status !== 'finished' || (list || []).length === 1)))
      .catch(() => {});
  }, [id]);

  const wanted = params.get('session');
  const current = sessions.find((x) => x._id === wanted) || sessions.find((x) => x.clock?.clock_status === 'running') || sessions.find((x) => x.status === 'running') || sessions[0];

  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas text-white">
        <p className="text-2xl font-bold">Torneio não encontrado</p>
        <Link to="/torneios" className="text-brand-fg underline">Voltar</Link>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-canvas p-4 text-fg md:p-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between pb-4">
        <Link
          to={`/torneios?id=${id}&tab=salao`}
          className="inline-flex items-center gap-2 btn btn-secondary btn-sm"
        >
          <ArrowLeft size={14} /> Painel
        </Link>
        <span className="inline-flex items-center gap-2 text-lg font-bold tracking-[0.18em] text-fg">GENESIS</span>
        <button
          type="button"
          onClick={goFullscreen}
          className="inline-flex items-center gap-2 btn btn-secondary btn-sm"
        >
          <Maximize2 size={14} /> Tela cheia
        </button>
      </div>

      <div className="mx-auto max-w-6xl">
        {sessions.length > 1 && (
          <div className="mb-4 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Sessão exibida">
            {sessions.map((x) => (
              <button key={x._id} type="button" role="tab" aria-selected={current?._id === x._id} onClick={() => setParams({ session: x._id })}
                className={`btn btn-sm ${current?._id === x._id ? 'btn-primary' : 'btn-secondary'}`}>{x.name}</button>
            ))}
          </div>
        )}
        {(sessions.length === 0 || current) && <TournamentClock key={current?._id || 'torneio'} tournamentId={id} sessionId={current?._id} variant="projection" />}
      </div>

      {name && (
        <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.4em] text-zinc-500">{name}{current && sessions.length > 1 ? ` · ${current.name}` : ''}</p>
      )}
    </div>
  );
}
