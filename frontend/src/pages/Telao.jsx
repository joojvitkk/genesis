import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Maximize2, ArrowLeft } from 'lucide-react';
import TournamentClock from '../components/TournamentClock';
import { apiGet } from '../lib/api';

/**
 * Tela de projeção — para abrir na TV do salão. Sem sidebar, fundo escuro.
 */
export default function Telao() {
  const { id } = useParams();
  const [name, setName] = useState('');
  const [running, setRunning] = useState([]); // sessões em andamento (Dia 1A, 1B…): a TV mostra QUAL sessão está no ar
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiGet(`/tournaments/${id}`)
      .then((t) => setName(t.name))
      .catch((e) => { if (e.status === 404) setNotFound(true); });
    apiGet(`/tournaments/${id}/sessions`)
      .then((list) => setRunning((list || []).filter((x) => x.status === 'running').map((x) => x.name)))
      .catch(() => {});
  }, [id]);

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
        <TournamentClock tournamentId={id} variant="projection" />
      </div>

      {name && (
        <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.4em] text-zinc-500">{name}{running.length ? ` · ${running.join(' + ')}` : ''}</p>
      )}
    </div>
  );
}
