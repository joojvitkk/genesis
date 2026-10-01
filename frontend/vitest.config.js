import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' }, // testes de componentes (sem o plugin do React)
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
  },
});
