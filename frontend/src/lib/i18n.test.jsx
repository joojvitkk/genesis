import { describe, it, expect } from 'vitest';
import { translate } from './i18n.jsx';
import pt from '../locales/pt';
import en from '../locales/en';

describe('i18n', () => {
  it('traduz nas duas línguas', () => {
    expect(translate('pt', 'nav.torneios')).toBe('Torneios');
    expect(translate('en', 'nav.torneios')).toBe('Tournaments');
  });

  it('faz fallback para pt e depois para a própria chave', () => {
    expect(translate('en', 'lang.label')).toBe('Language');
    expect(translate('xx', 'nav.chat')).toBe('Chat');        // língua desconhecida → pt
    expect(translate('pt', 'chave.inexistente')).toBe('chave.inexistente');
  });

  it('substitui variáveis {x}', () => {
    expect(translate('pt', 'x', undefined)).toBe('x');
  });

  it('pt e en têm o mesmo conjunto de chaves', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
  });
});
