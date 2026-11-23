import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useConnection } from '../hooks/useConnection';

const MAP = {
  online: { cls: 'badge badge-ok', icon: Wifi, label: 'Online' },
  reconnecting: { cls: 'badge badge-warn', icon: RefreshCw, label: 'Reconectando…' },
  offline: { cls: 'badge badge-danger', icon: WifiOff, label: 'Sem conexão — lançamentos bloqueados' },
};

/** Indicador de conexão sempre visível nas telas do Salão. */
export default function ConnectionStatus({ className = '' }) {
  const state = useConnection();
  const { cls, icon: Icon, label } = MAP[state];
  return (
    <span role="status" aria-live="polite" data-testid="connection-status" data-state={state} className={`${cls} ${className}`}>
      <Icon size={12} /> {label}
    </span>
  );
}
