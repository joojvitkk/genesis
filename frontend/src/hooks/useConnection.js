import { useEffect, useState } from 'react';
import { socket } from '../lib/socket';

/**
 * Estado da conexão para o indicador do Salão: 'online' (rede e socket ok), 'offline' (sem rede) ou 'reconnecting'
 * (rede volta, socket ainda reconectando). O app é só online: offline bloqueia os lançamentos (sem fila).
 */
export function useConnection() {
  const read = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    return socket.connected ? 'online' : 'reconnecting';
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    socket.on('connect', update);
    socket.on('disconnect', update);
    socket.on('connect_error', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      socket.off('connect', update);
      socket.off('disconnect', update);
      socket.off('connect_error', update);
    };
  }, []);
  return state;
}
