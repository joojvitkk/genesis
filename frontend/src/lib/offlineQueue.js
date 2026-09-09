import { api } from './api';

const KEY = 'genesis_offline_queue';

// Só operações seguras de repetir entram na fila offline.
const QUEUEABLE = [
  /^\/tournaments\/[^/]+\/entries$/,
  /^\/tournaments\/[^/]+\/eliminations$/,
];

export function isQueueable(path) {
  return QUEUEABLE.some((rx) => rx.test(path));
}

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

export function queuedCount() {
  return read().length;
}

/** Enfileira uma escrita para reenviar quando a rede voltar. */
export function enqueue(path, body) {
  const items = read();
  items.push({ id: crypto.randomUUID?.() || String(Date.now() + Math.random()), path, body, at: Date.now() });
  write(items);
  return items.length;
}

let flushing = false;
/** Reenvia a fila. Retorna quantas ações sincronizaram. */
export async function flushOfflineQueue() {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    let items = read();
    while (items.length) {
      const item = items[0];
      try {
        await api(item.path, { method: 'POST', body: item.body });
        sent += 1;
        items = items.slice(1);
        write(items);
      } catch (e) {
        if (e.status === 0) break;          // ainda offline — para e tenta depois
        // erro do servidor (400/409 etc): descarta o item para não travar a fila
        items = items.slice(1);
        write(items);
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
