import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/define-event.ts'],
  target: 'es2020',
  format: ['cjs', 'esm'],
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: true,
});
