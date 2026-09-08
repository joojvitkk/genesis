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
