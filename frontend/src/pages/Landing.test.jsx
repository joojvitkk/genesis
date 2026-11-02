import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';
import { I18nProvider } from '../lib/i18n.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let container;
const mount = async (props = {}) => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<I18nProvider><MemoryRouter><Landing theme="light" onToggleTheme={props.onToggleTheme || (() => {})} {...props} /></MemoryRouter></I18nProvider>); });
};
beforeEach(() => { vi.useFakeTimers(); window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

describe('Landing /site', () => {
  it('abre com a dor, mostra a mesma noite com e sem sistema, o produto, os perfis e as perguntas', async () => {
    await mount();
    for (const id of ['problema', 'pratica', 'perfis', 'confianca', 'faq']) expect(container.querySelector(`#${id}`), id).toBeTruthy();
    expect(container.querySelector('h1').textContent).toContain('Com a mesa cheia, ninguém pode errar a conta.');
    expect(container.querySelectorAll('#problema li').length).toBe(5);          // cinco momentos da noite
    expect(container.querySelector('#problema').textContent).toContain('Sem sistema');
    expect(container.querySelector('#problema').textContent).toContain('Com o Genesis');
    expect(container.querySelectorAll('#pratica h3').length).toBe(3);
    expect(container.querySelectorAll('#faq details').length).toBeGreaterThanOrEqual(5);
  });
  it('sem cara de template: nenhuma grade de cartões com ícone e sem emoji', async () => {
    await mount();
    expect(container.querySelectorAll('li.card').length).toBe(0);
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
  it('CTA leva ao login (visitante) ou ao painel (logado)', async () => {
    await mount();
    expect([...container.querySelectorAll('a[href="/login"]')].length).toBeGreaterThanOrEqual(3);
    act(() => root.unmount()); container.remove();
    await mount({ ctaTo: '/dashboard', ctaLabel: 'Abrir o painel' });
    expect(container.querySelector('a[href="/dashboard"]').textContent).toContain('Abrir o painel');
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });
  it('perfis mostram o menu REAL de cada papel (mesma fonte do aplicativo)', async () => {
    await mount();
    const menu = () => container.querySelector('[data-testid="role-menu"]').textContent;
    expect(menu()).toContain('Usuários'); expect(menu()).toContain('Auditoria');
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Salão');
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(menu()).not.toContain('Usuários'); expect(menu()).not.toContain('Auditoria'); expect(menu()).toContain('Tracking Sheet');
  });
  it('celular e TV compartilham o mesmo estado: registrar entrada e pausar refletem na TV', async () => {
    await mount();
    const q = (id) => container.querySelector(`[data-testid="${id}"]`).textContent;
    expect(q('tv-players')).toBe('142'); expect(q('phone-players')).toBe('142');
    const btn = (t) => [...container.querySelectorAll('[data-testid="demo-phone"] button')].find((b) => b.textContent.includes(t));
    await act(async () => { btn('Registrar entrada').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(q('tv-players')).toBe('143'); expect(q('phone-players')).toBe('143');
    const clock = () => container.querySelector('[data-testid="demo-clock"] p.font-mono').textContent;
    await act(async () => { btn('Pausar').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const frozen = clock(); expect(container.querySelector('[data-testid="demo-clock"]').textContent).toContain('Pausado');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(clock()).toBe(frozen);
  });
  it('faixa de fatos usa números reais do produto (módulos e perfis) e nenhum dinheiro', async () => {
    await mount();
    const facts = container.querySelector('section[aria-label="O Genesis em fatos"]').textContent;
    expect(facts).toContain('16'); expect(facts).toContain('módulos de operação'); expect(facts).toContain('0valores em dinheiro');
  });
  it('seção de confiança lista as seis garantias', async () => {
    await mount();
    expect(container.querySelectorAll('#confianca dt').length).toBe(6);
  });
  it('relógio de demonstração conta regressivamente e é marcado como exemplo', async () => {
    await mount();
    const clock = () => container.querySelector('[data-testid="demo-clock"] p.font-mono').textContent;
    expect(clock()).toBe('18:42');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(clock()).toBe('18:39');
    expect(container.querySelector('[data-testid="demo-clock"]').textContent).toContain('exemplo ilustrativo');
  });
  it('botão de tema chama onToggleTheme; nada fala de dinheiro', async () => {
    const onToggleTheme = vi.fn(); await mount({ onToggleTheme });
    await act(async () => { container.querySelector('button[aria-label="Modo escuro"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/R\$|prêmio em dinheiro|rake/i);
  });
});
