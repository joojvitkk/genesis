import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Avatar from './Avatar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let box;
afterEach(() => { act(() => root.unmount()); box.remove(); });
const mount = async (el) => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); await act(async () => { root.render(el); }); };

describe('Avatar', () => {
  it('com foto mostra a imagem (decorativa); sem foto mostra a inicial do nome', async () => {
    await mount(<Avatar user={{ name: 'Axl Rose', avatar: 'data:image/jpeg;base64,AAAA' }} />);
    const img = box.querySelector('img');
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
    expect(img.getAttribute('alt')).toBe('');
    act(() => root.unmount()); box.remove();
    await mount(<Avatar user={{ name: 'kai hansen' }} size="lg" />);
    expect(box.querySelector('img')).toBeNull();
    expect(box.textContent).toBe('K');
  });
});
