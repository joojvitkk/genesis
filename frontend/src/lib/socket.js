import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';
import { getToken } from './auth';

// Conexão manual: só conecta após o login (com token).
export const socket = io(BACKEND_URL, {
  autoConnect: false,
  auth: (cb) => cb({ token: getToken() }),
});

export function connectSocket() {
  if (!getToken()) return;
  socket.auth = (cb) => cb({ token: getToken() });
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}

// Salas assinadas: ao reconectar (queda de rede, servidor reiniciado) o cliente volta sozinho às salas do torneio, da sessão
// e do chat — o servidor perde as salas quando a conexão cai. Quem precisa do estado atual também escuta 'connect'.
const rooms = new Map(); // `${join}:${id}` → { join, leave, id, refs }
export function trackRoom(join, leave, id) {
  const k = `${join}:${id}`;
  const cur = rooms.get(k) || { join, leave, id, refs: 0 };
  cur.refs += 1;
  rooms.set(k, cur);
  socket.emit(join, id);
  return () => {
    const r = rooms.get(k);
    if (!r) return;
    r.refs -= 1;
    if (r.refs <= 0) { rooms.delete(k); socket.emit(r.leave, r.id); }
  };
}
socket.on('connect', () => rooms.forEach((r) => socket.emit(r.join, r.id)));
export const trackedRooms = () => [...rooms.values()];
