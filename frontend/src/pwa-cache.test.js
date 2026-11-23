// Item 13: o cache do PWA não pode servir dados de um usuário para outro.
// Garantia adotada: o service worker NÃO cacheia a API (só o pré-carregamento dos arquivos do app), e o logout limpa qualquer
// cache de API deixado por versões antigas e a folha digital guardada no navegador (cuja chave já é por usuário).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { clearSession } from './lib/auth';
import { cacheKey } from './lib/trackingFormat';

describe('cache do PWA e isolamento entre usuários', () => {
  it('o service worker não define cache de API em runtime', () => {
    const cfg = readFileSync(resolve(process.cwd(), 'vite.config.js'), 'utf8');
    expect(cfg).toMatch(/runtimeCaching:\s*\[\s*\]/);
  });

  it('a chave do cache da folha digital é por usuário (um usuário nunca lê a folha de outro)', () => {
    expect(cacheKey('u1', 's1')).not.toBe(cacheKey('u2', 's1'));
  });

  describe('logout', () => {
    const deleted = [];
    beforeEach(() => {
      deleted.length = 0;
      vi.stubGlobal('caches', { keys: async () => ['genesis-api', 'workbox-precache-v2'], delete: async (k) => { deleted.push(k); return true; } });
      localStorage.clear();
    });

    it('apaga a folha digital em cache e qualquer cache de API antigo, e mantém o pré-carregamento do app', async () => {
      localStorage.setItem(cacheKey('u1', 's1'), '{"data":1}');
      localStorage.setItem('genesis_token', 'x');
      clearSession();
      await new Promise((r) => setTimeout(r, 10));
      expect(localStorage.getItem(cacheKey('u1', 's1'))).toBeNull();
      expect(deleted).toEqual(['genesis-api']);
    });
  });
});
