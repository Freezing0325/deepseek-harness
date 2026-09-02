import { defineConfig } from 'tsdown'

/**
 * Node-only host plugin. The ps1 script ships as a static asset copied by the
 * package's `files` list; the bundle only carries the host entry.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})