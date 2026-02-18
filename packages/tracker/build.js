import { build } from 'esbuild';

await build({
  entryPoints: ['src/tracker.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/tracker.js',
});

console.log('Tracker built to dist/tracker.js');
