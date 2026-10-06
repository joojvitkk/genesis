import { describe, it, expect, beforeEach } from 'vitest';
import { tr, setRuntimeLang, locale } from './translate';
import EN from '../../locales/en-ui';

describe('tr()', () => {
  beforeEach(() => setRuntimeLang('en'));

  it('traduz texto exato, preservando espaços das pontas', () => {
    expect(tr('Cancelar')).toBe('Cancel');
    expect(tr('  Salvar ')).toBe('  Save ');
  });
  it('traduz texto com valores embutidos ({}) e traduz os valores que também são texto', () => {
    expect(tr('3 ocorrência(s) vermelha(s) em aberto')).toBe('3 open red incident(s)');
    expect(tr('Template "Warm Up" aplicado.')).toBe('Template "Warm Up" applied.');
    expect(tr('Erro 500')).toBe('Error 500');
  });
  it('não mexe em dado desconhecido nem em não-string', () => {
    expect(tr('Warm Up')).toBe('Warm Up');
    expect(tr(42)).toBe(42);
    expect(tr(null)).toBe(null);
  });
  it('em português é a identidade e o locale muda com o idioma', () => {
    setRuntimeLang('pt');
    expect(tr('Cancelar')).toBe('Cancelar');
    expect(locale()).toBe('pt-BR');
    setRuntimeLang('en');
    expect(locale()).toBe('en-US');
  });
});

describe('dicionário en-ui', () => {
  it('cada tradução mantém a mesma quantidade de curingas {} do original (valores não se perdem)', () => {
    const bad = Object.entries(EN).filter(([pt, en]) => (pt.match(/\{\}/g) || []).length !== (en.match(/\{\}/g) || []).length);
    expect(bad).toEqual([]);
  });
  it('não há tradução vazia', () => {
    expect(Object.entries(EN).filter(([, en]) => !String(en).trim())).toEqual([]);
  });
});
