// Item 13: Idempotency-Key nos lançamentos, volta automática às salas do socket e indicador de conexão.
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('api: Idempotency-Key', () => {
  beforeEach(() => { globalThis.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => '{}' }); });

  it('POST/PUT levam uma chave; GET não; a chave informada é reaproveitada no reenvio', async () => {
    const { api, apiPost } = await import('./api');
    await api('/x');
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBeUndefined();
    await apiPost('/tournaments/t/entries', { a: 1 });
    await apiPost('/tournaments/t/entries', { a: 1 });
    const [k1, k2] = fetch.mock.calls.slice(1).map((c) => c[1].headers['Idempotency-Key']);
    expect(k1).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(k1).not.toBe(k2); // intenções diferentes → chaves diferentes
    await apiPost('/tournaments/t/entries', { a: 1 }, { idempotencyKey: 'toque-1234' });
    await apiPost('/tournaments/t/entries', { a: 1 }, { idempotencyKey: 'toque-1234' });
    const same = fetch.mock.calls.slice(3).map((c) => c[1].headers['Idempotency-Key']);
    expect(same).toEqual(['toque-1234', 'toque-1234']);
  });
});

describe('socket: salas assinadas', () => {
  it('ao reconectar, volta sozinho às salas; sair da última assinatura emite o leave', async () => {
    vi.resetModules();
    const handlers = {};
    const emit = vi.fn();
    vi.doMock('socket.io-client', () => ({ io: () => ({ on: (e, f) => { handlers[e] = f; }, emit, connected: false, auth: null }) }));
    const { trackRoom } = await import('./socket');
    const off = trackRoom('joinTournament', 'leaveTournament', 't1');
    const off2 = trackRoom('joinTournament', 'leaveTournament', 't1');
    expect(emit).toHaveBeenCalledWith('joinTournament', 't1');
    emit.mockClear();
    handlers.connect(); // reconexão
    expect(emit).toHaveBeenCalledWith('joinTournament', 't1');
    emit.mockClear();
    off();
    expect(emit).not.toHaveBeenCalled(); // ainda há outra assinatura
    off2();
    expect(emit).toHaveBeenCalledWith('leaveTournament', 't1');
    emit.mockClear();
    handlers.connect();
    expect(emit).not.toHaveBeenCalled(); // sala liberada não volta
  });
});
