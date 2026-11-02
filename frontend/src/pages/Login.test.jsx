import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('../lib/api', () => api);
import Login from './Login';

let root; let container; const onLogin = vi.fn(); const onToggleTheme = vi.fn();
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const setVal = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
beforeEach(async () => {
  api.apiPost.mockReset(); onLogin.mockReset(); onToggleTheme.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><Login onLogin={onLogin} theme="dark" onToggleTheme={onToggleTheme} /></MemoryRouter>); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Login', () => {
  it('campos rotulados, e-mail com foco automático e ajuda de primeiro acesso', () => {
    expect(container.querySelector('label[for="login-email"]')).toBeTruthy();
    expect(container.querySelector('label[for="login-password"]')).toBeTruthy();
    expect(document.activeElement).toBe(container.querySelector('#login-email'));
    expect(container.textContent).toContain('Primeiro acesso ou senha perdida?');
    expect(container.querySelector('a[href="/site"]')).toBeTruthy();
  });
  it('envia e-mail (sem espaços) e senha; sucesso chama onLogin com token e usuário', async () => {
    api.apiPost.mockResolvedValue({ token: 'tk', user: { role: 'admin' } });
    await setVal(container.querySelector('#login-email'), '  a@b.com ');
    await setVal(container.querySelector('#login-password'), 'segredo');
    await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/login', { email: 'a@b.com', password: 'segredo' });
    expect(onLogin).toHaveBeenCalledWith('tk', { role: 'admin' });
  });
  it('erro do servidor aparece como alerta junto ao formulário e marca os campos', async () => {
    api.apiPost.mockRejectedValue(new Error('Credenciais inválidas'));
    await setVal(container.querySelector('#login-email'), 'a@b.com'); await setVal(container.querySelector('#login-password'), 'x');
    await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Credenciais inválidas');
    expect(container.querySelector('#login-password').getAttribute('aria-invalid')).toBe('true');
    expect(onLogin).not.toHaveBeenCalled();
  });
  it('mostrar/ocultar senha e botão de tema', async () => {
    const pw = container.querySelector('#login-password'); expect(pw.type).toBe('password');
    const eye = container.querySelector('button[aria-label="Mostrar senha"]');
    await act(async () => { eye.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(pw.type).toBe('text'); expect(eye.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { container.querySelector('button[aria-label="Modo claro"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onToggleTheme).toHaveBeenCalled();
  });
  it('avisa quando o Caps Lock está ligado', async () => {
    const pw = container.querySelector('#login-password');
    await act(async () => { const e = new KeyboardEvent('keyup', { bubbles: true }); e.getModifierState = () => true; pw.dispatchEvent(e); });
    expect(container.textContent).toContain('Caps Lock está ativado.');
  });
});
