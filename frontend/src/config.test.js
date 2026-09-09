import { describe, it, expect } from 'vitest';
import { can, homeRoute, ROUTE_AREA, PERMISSIONS } from './config';

describe('permissões (config.js)', () => {
  it('admin acessa tudo', () => {
    for (const area of PERMISSIONS.admin) expect(can('admin', area)).toBe(true);
    expect(can('admin', 'usuarios')).toBe(true);
  });

  it('salão não acessa usuarios nem ficharios', () => {
    expect(can('salao', 'usuarios')).toBe(false);
    expect(can('salao', 'ficharios')).toBe(false);
    expect(can('salao', 'torneios')).toBe(true);
  });

  it('material não acessa usuarios', () => {
    expect(can('material', 'usuarios')).toBe(false);
    expect(can('material', 'relatorios')).toBe(true);
  });

  it('papel desconhecido não acessa nada', () => {
    expect(can(undefined, 'dashboard')).toBe(false);
    expect(can('hacker', 'dashboard')).toBe(false);
  });

  it('homeRoute e ROUTE_AREA coerentes', () => {
    expect(homeRoute('admin')).toBe('/dashboard');
    expect(homeRoute('salao')).toBe('/salao');
    expect(ROUTE_AREA['/usuarios']).toBe('usuarios');
  });
});
