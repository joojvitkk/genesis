import { describe, it, expect } from 'vitest';
import { can, homeRoute, ROUTE_AREA, PERMISSIONS, LEVELS } from './config';

describe('permissões (config.js) — área × nível', () => {
  it('admin administra tudo', () => {
    for (const [area, level] of Object.entries(PERMISSIONS.admin)) { expect(level).toBe('manage'); expect(can('admin', area, 'manage')).toBe(true); }
    expect(can('admin', 'usuarios', 'manage')).toBe(true);
  });

  it('material OPERA, mas não administra: não cria ficha/modelo/fichário/stack/torneio', () => {
    for (const area of ['estoque', 'ficharios', 'torneios', 'chip_race']) {
      expect(can('material', area, 'operate')).toBe(true);
      expect(can('material', area, 'manage')).toBe(false);
    }
    expect(can('material', 'modelos_stack', 'manage')).toBe(false);
    expect(can('material', 'usuarios')).toBe(false);
    expect(can('material', 'relatorios')).toBe(true);
    expect(can('material', 'relatorios', 'operate')).toBe(false);
  });

  it('salão (D3): só consulta o estoque e o torneio; opera mesas e chat', () => {
    expect(can('salao', 'mesas', 'operate')).toBe(true);
    expect(can('salao', 'chat', 'operate')).toBe(true);
    for (const area of ['estoque', 'torneios', 'chip_race', 'dashboard', 'modelos_stack']) { expect(can('salao', area)).toBe(true); expect(can('salao', area, 'operate')).toBe(false); }
    for (const area of ['usuarios', 'ficharios', 'relatorios']) expect(can('salao', area)).toBe(false);
  });

  it('níveis são cumulativos: quem administra também opera e consulta', () => {
    expect(LEVELS).toEqual(['view', 'operate', 'manage']);
    expect([can('admin', 'estoque', 'view'), can('admin', 'estoque', 'operate'), can('admin', 'estoque', 'manage')]).toEqual([true, true, true]);
    expect([can('material', 'estoque', 'view'), can('material', 'estoque', 'operate'), can('material', 'estoque', 'manage')]).toEqual([true, true, false]);
  });

  it('modelos de fichário: admin e material veem; salão não', () => {
    expect(can('admin', ROUTE_AREA['/modelos-ficharios'])).toBe(true);
    expect(can('material', ROUTE_AREA['/modelos-ficharios'])).toBe(true);
    expect(can('salao', ROUTE_AREA['/modelos-ficharios'])).toBe(false);
  });

  it('papel desconhecido ou área desconhecida não acessa nada', () => {
    expect(can(undefined, 'dashboard')).toBe(false);
    expect(can('hacker', 'dashboard')).toBe(false);
    expect(can('admin', 'inexistente')).toBe(false);
  });

  it('homeRoute e ROUTE_AREA coerentes; toda rota aponta para uma área que existe', () => {
    expect(homeRoute('admin')).toBe('/dashboard');
    expect(homeRoute('salao')).toBe('/salao');
    expect(ROUTE_AREA['/usuarios']).toBe('usuarios');
    expect(ROUTE_AREA['/modelos-ficharios']).toBe('ficharios');
    expect(ROUTE_AREA['/eventos']).toBe('torneios');
    expect(ROUTE_AREA['/salao']).toBe('mesas');
    const areas = new Set(Object.keys(PERMISSIONS.admin));
    for (const [route, area] of Object.entries(ROUTE_AREA)) expect(areas.has(area), route).toBe(true);
    for (const role of ['admin', 'material', 'salao']) expect(can(role, ROUTE_AREA[homeRoute(role)])).toBe(true);
  });
});
