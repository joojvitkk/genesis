// Menu lateral agrupado: 4 grupos para o admin; Material/Salão só o autorizado e sem grupos vazios.
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar, { NAV_GROUPS, visibleGroups } from './Sidebar';
import { I18nProvider } from '../lib/i18n.jsx';
import { PERMISSIONS, ROUTE_AREA } from '../config';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let container;
afterEach(() => { act(() => root?.unmount()); container?.remove(); });

const render = async (role, path = '/dashboard') => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider><MemoryRouter initialEntries={[path]}><Sidebar isOpen={false} onOpen={() => {}} onClose={() => {}} onLogout={() => {}} user={{ role, name: 'X' }} theme="light" onToggleTheme={() => {}} /></MemoryRouter></I18nProvider>);
  });
  return container.querySelector('aside');
};
const links = (aside) => [...aside.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
const groupTitles = (aside) => [...aside.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'));

describe('Sidebar agrupado', () => {
  it('admin vê os 4 grupos na ordem e os 16 itens na sequência definida', async () => {
    const aside = await render('admin');
    expect(groupTitles(aside)).toEqual(['Visão geral e planejamento', 'Operação', 'Estoque e configurações', 'Gestão e controle']);
    expect(links(aside)).toEqual([
      '/dashboard', '/eventos', '/torneios', '/tracking-sheet',
      '/salao', '/chip-race', '/ocorrencias', '/chat',
      '/estoque', '/fichas-ko', '/ficharios', '/modelos-stack',
      '/relatorios', '/livro-estoque', '/auditoria', '/usuarios',
    ]);
  });

  it('Material e Salão: só módulos autorizados pela matriz, Tracking Sheet incluída (consulta) e sem grupos vazios', async () => {
    for (const role of ['material', 'salao']) {
      const aside = await render(role);
      const hrefs = links(aside);
      expect(hrefs).toContain('/tracking-sheet');
      expect(hrefs).not.toContain('/usuarios');
      expect(hrefs).not.toContain('/auditoria');
      for (const h of hrefs) expect(PERMISSIONS[role][ROUTE_AREA[h]], `${role} → ${h}`).toBeTruthy();
      expect(container.querySelectorAll('[role="group"] > div:empty').length).toBe(0);
      act(() => root.unmount()); container.remove();
    }
  });

  it('grupo só mostra itens autorizados: salão em "Gestão e controle" vê apenas o Livro Razão; papel sem permissão não vê grupo algum', () => {
    const control = visibleGroups('salao').find((g) => g.key === 'nav.group.control');
    expect(control.items.map((i) => i.to)).toEqual(['/livro-estoque']);
    expect(visibleGroups('salao').every((g) => g.items.length > 0)).toBe(true);
    expect(visibleGroups('desconhecido')).toEqual([]);
  });

  it('página ativa recebe o destaque (nav-item-active) e aria-current', async () => {
    const aside = await render('admin', '/tracking-sheet');
    const active = aside.querySelector('a.nav-item-active');
    expect(active.getAttribute('href')).toBe('/tracking-sheet');
    expect(active.getAttribute('aria-current')).toBe('page');
  });

  it('todo item aponta para uma rota com área de permissão (rotas existentes preservadas)', () => {
    for (const g of NAV_GROUPS) for (const i of g.items) expect(ROUTE_AREA[i.to]).toBe(i.area);
  });

  it('barra inferior mobile e drawer existem; drawer repete os grupos', async () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<I18nProvider><MemoryRouter><Sidebar isOpen onOpen={() => {}} onClose={() => {}} onLogout={() => {}} user={{ role: 'admin' }} theme="light" onToggleTheme={() => {}} /></MemoryRouter></I18nProvider>); });
    const drawer = container.querySelector('[role="dialog"]');
    expect(drawer.querySelectorAll('[role="group"]').length).toBe(4);
    expect(container.querySelector('nav[aria-label="Atalhos"]')).toBeTruthy();
  });
});
