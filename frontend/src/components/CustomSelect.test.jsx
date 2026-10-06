import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act, useState } from 'react';
import CustomSelect from './CustomSelect';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let box;
afterEach(() => { act(() => root.unmount()); box.remove(); });

function Host({ onPick }) {
  const [v, setV] = useState('');
  return (
    <div style={{ overflow: 'hidden', height: 40 }}>
      <CustomSelect aria-label="Fuso" options={[{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gama' }]} value={v} onChange={(x) => { setV(x); onPick(x); }} />
    </div>
  );
}
const mount = async (onPick) => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); await act(async () => { root.render(<Host onPick={onPick} />); }); };
const key = (el, k) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('CustomSelect', () => {
  it('o menu é desenhado num portal (fora do container com overflow) e escolhe por clique', async () => {
    const pick = vi.fn(); await mount(pick);
    const btn = box.querySelector('button');
    await act(async () => { btn.click(); });
    const list = document.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect(box.contains(list)).toBe(false);          // fora do popup/overflow: não é cortado
    expect(list.parentElement).toBe(document.body);
    await act(async () => { [...list.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Beta')).click(); });
    expect(pick).toHaveBeenCalledWith('b');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(btn.textContent).toContain('Beta');
  });

  it('teclado: ↓ abre, ↓ move, Enter escolhe, Esc fecha', async () => {
    const pick = vi.fn(); await mount(pick);
    const btn = box.querySelector('button');
    await key(btn, 'ArrowDown');
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    await key(btn, 'ArrowDown'); await key(btn, 'Enter');
    expect(pick).toHaveBeenCalledWith('b');
    await key(btn, 'ArrowDown');
    await key(btn, 'Escape');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
