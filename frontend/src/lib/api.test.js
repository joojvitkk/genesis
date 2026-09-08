import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from './api';
import { setUnauthorizedHandler, saveSession, getToken } from './auth';

beforeEach(() => {
  localStorage.clear();
  saveSession('tok123', { role: 'admin' });
});
afterEach(() => vi.restoreAllMocks());

describe('cliente de API', () => {
  it('injeta o header Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/chips');

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer tok123');
  });

  it('codifica query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/inventory/logs', { params: { search: 'a & b', page: 2 } });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('search=a+%26+b');
    expect(String(url)).toContain('page=2');
  });

  it('no 401 dispara o handler global e limpa a sessão', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"x"}', { status: 401 })));

    await expect(api('/me')).rejects.toThrow();
    expect(onUnauth).toHaveBeenCalledOnce();
    expect(getToken()).toBe(null);
  });

  it('erro não-ok vira Error com .status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Nome obrigatório"}', { status: 400 })));
    await expect(api('/chips', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 400,
      message: 'Nome obrigatório',
    });
  });
});
