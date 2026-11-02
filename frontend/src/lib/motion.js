// Movimento do Genesis (Apple Design §3–§7): molas interrompíveis, saída espelhada, nada trava a entrada do usuário.
// Padrão = mola criticamente amortecida (bounce 0). Quique (≈0.2) só quando o gesto tinha momento (arrastar/lançar).
export const SPRING = { type: 'spring', bounce: 0, duration: 0.4 };       // mover / reposicionar
export const SPRING_SNAP = { type: 'spring', bounce: 0, duration: 0.3 };  // resposta rápida (menus, toasts)
export const SPRING_SHEET = { type: 'spring', bounce: 0.2, duration: 0.35 }; // gaveta/sheet arrastado
export const EXIT = { duration: 0.16, ease: [0.8, 0.22, 1, 0.2] };        // saída mais rápida que a entrada, curva espelhada

/** Painel que "materializa": escala + opacidade + desfoque juntos, saindo pelo mesmo caminho. Use com {...modalMotion}. */
export const modalMotion = {
  initial: { opacity: 0, scale: 0.96, y: 8, filter: 'blur(6px)' },
  animate: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: SPRING_SNAP },
  exit: { opacity: 0, scale: 0.97, y: 4, filter: 'blur(4px)', transition: EXIT },
};

/** Fundo de escurecimento (dim to focus). */
export const scrimMotion = {
  initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.2 } }, exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Entrada de bloco de página: sobe 8 px e aparece (sem atraso artificial). */
export const riseMotion = {
  initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: SPRING_SNAP },
};
