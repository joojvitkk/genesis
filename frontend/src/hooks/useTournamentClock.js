import { useEffect, useRef, useState } from 'react';
import { socket, connectSocket } from '../lib/socket';

/**
 * Assina o relógio de um torneio via socket e mantém a contagem local
 * entre os pulsos do servidor (sincronizando pelo `server_time`).
 *
 * Retorna: { ...payloadDoServidor, remainingMs, connected }
 * e chama os callbacks opcionais em mudança de nível / marcador / fim.
 */
export function useTournamentClock(tournamentId, { onLevel, onMarker, onEnded } = {}) {
  const [state, setState] = useState(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const offsetRef = useRef(0); // server_time - Date.now()
  const cbs = useRef({ onLevel, onMarker, onEnded });
  useEffect(() => { cbs.current = { onLevel, onMarker, onEnded }; });

  useEffect(() => {
    if (!tournamentId) return;
    connectSocket();

    const onClock = (p) => {
      if (String(p.tournament_id) !== String(tournamentId)) return;
      offsetRef.current = p.server_time - Date.now();
      setState(p);
      setRemainingMs(p.remaining_ms);
    };
    const onLevelChanged = (p) => { if (String(p.tournament_id) === String(tournamentId)) cbs.current.onLevel?.(p); };
    const onMk = (p) => { if (String(p.tournament_id) === String(tournamentId)) cbs.current.onMarker?.(p); };
    const onEnd = (p) => { if (String(p.tournament_id) === String(tournamentId)) cbs.current.onEnded?.(p); };
    const onConnect = () => { setConnected(true); socket.emit('joinTournament', tournamentId); };
    const onDisconnect = () => setConnected(false);

    socket.on('tournamentClock', onClock);
    socket.on('tournamentLevelChanged', onLevelChanged);
    socket.on('tournamentMarker', onMk);
    socket.on('tournamentEnded', onEnd);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.emit('joinTournament', tournamentId);

    return () => {
      socket.emit('leaveTournament', tournamentId);
      socket.off('tournamentClock', onClock);
      socket.off('tournamentLevelChanged', onLevelChanged);
      socket.off('tournamentMarker', onMk);
      socket.off('tournamentEnded', onEnd);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [tournamentId]);

  // Contagem local entre os pulsos do servidor
  useEffect(() => {
    if (!state || state.clock_status !== 'running') return;
    const endsAt = state.server_time + state.remaining_ms; // instante do fim, no relógio do servidor
    const id = setInterval(() => {
      setRemainingMs(endsAt - (Date.now() + offsetRef.current));
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  return { ...(state || {}), remainingMs, connected };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
