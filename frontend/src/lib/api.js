import { BACKEND_URL } from '../config';
import { getToken, notifyUnauthorized } from './auth';

/**
 * Cliente HTTP central.
 * - injeta o header Authorization
 * - serializa query params com encode
 * - em 401 dispara logout global
 * - lança Error com `.status` e `.data` em respostas não-ok
 */
export async function api(path, { method = 'GET', body, params, signal } = {}) {
  const base = BACKEND_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const url = new URL(`${base}/api${path.startsWith('/') ? path : '/' + path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('Falha de conexão com o servidor.');
    err.status = 0;
    throw err;
  }

  if (res.status === 401) {
    notifyUnauthorized();
    const err = new Error('Sessão expirada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const apiGet = (path, params) => api(path, { params });
export const apiPost = (path, body) => api(path, { method: 'POST', body });
export const apiPut = (path, body) => api(path, { method: 'PUT', body });
export const apiDelete = (path) => api(path, { method: 'DELETE' });
