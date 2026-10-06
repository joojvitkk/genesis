import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './api';
import { socket } from './socket';

// Qual bloco do painel cada evento em tempo real invalida (G10): o painel refaz só o que mudou.
export const EVENT_BLOCKS = {
  movementsPosted: ['metrics', 'inventory', 'in_play', 'flows', 'timeline', 'conflicts', 'binders', 'free_binders', 'tournament_chips'],
  balancesChanged: ['metrics', 'inventory', 'in_play', 'free_binders', 'tournament_chips'],
  occurrenceOpened: ['occurrences', 'conflicts', 'timeline'],
  occurrenceUpdated: ['occurrences', 'conflicts'],
  materialChanged: ['reentries'],
  conversionRequestsChanged: ['requests'],
  chipRaceUpdated: ['metrics', 'requests', 'tournament_chips'],
  chipsInPlayChanged: ['tournament_chips'],
  // nível/fim de dia/fim de torneio: quem está "em andamento" pode ter mudado (a lista de relógios sai do mesmo bloco)
  tournamentsChanged: ['tournament_chips', 'metrics'],
  tournamentLevelChanged: ['tournament_chips', 'metrics'],
  tournamentMarker: ['tournament_chips', 'metrics'],
  tournamentEnded: ['tournament_chips', 'metrics'],
  allocationsChanged: ['metrics', 'free_binders'],
};
const POLL_MS = 30000;
const DEBOUNCE_MS = 250;

/**
 * Estado do dashboard: carga completa + polling + atualização por BLOCO via socket (com debounce que junta
 * vários eventos numa só chamada). `data` é a resposta de GET /dashboard/stats mesclada bloco a bloco.
 */
export function useDashboard() {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const pending = useRef(new Set());
  const timer = useRef(null);

  const load = useCallback(async (blocks) => {
    try {
      const res = await apiGet('/dashboard/stats', blocks?.length ? { blocks: blocks.join(',') } : undefined);
      setData((d) => ({ ...d, ...res }));
    } catch (e) {
      if (e.status !== 401) console.error('Error fetching dashboard data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(), POLL_MS);
    const handlers = Object.entries(EVENT_BLOCKS).map(([event, blocks]) => {
      const fn = () => {
        blocks.forEach((b) => pending.current.add(b));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { const list = [...pending.current]; pending.current.clear(); load(list); }, DEBOUNCE_MS);
      };
      socket.on(event, fn);
      return [event, fn];
    });
    return () => {
      clearInterval(poll); clearTimeout(timer.current);
      handlers.forEach(([event, fn]) => socket.off(event, fn));
    };
  }, [load]);

  return { data, loading, refresh: load };
}
