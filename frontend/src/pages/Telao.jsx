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
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiGet(`/tournaments/${id}`)
      .then((t) => setName(t.name))
      .catch((e) => { if (e.status === 404) setNotFound(true); });
  }, [id]);

  const goFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0A0A0A] text-white">
        <p className="text-2xl font-black uppercase tracking-widest">Torneio não encontrado</p>
        <Link to="/torneios" className="text-genesis-red underline">Voltar</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-4 md:p-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between pb-4">
        <Link
          to={`/torneios?id=${id}&tab=salao`}
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white"
        >
          <ArrowLeft size={14} /> Painel
        </Link>
        <span className="text-lg font-black uppercase tracking-[0.3em] text-genesis-red">GENESIS</span>
        <button
          type="button"
          onClick={goFullscreen}
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white"
        >
          <Maximize2 size={14} /> Tela cheia
        </button>
      </div>

      <div className="mx-auto max-w-6xl">
        <TournamentClock tournamentId={id} variant="projection" />
      </div>

      {name && (
        <p className="mt-6 text-center text-xs font-bold uppercase tracking-[0.4em] text-zinc-700">{name}</p>
      )}
    </div>
  );
}
