import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const buildTime = new Date().toISOString();

/**
 * Lazy-only third-party stacks. Both are reached only through dynamic import
 * (xlsx on export, mdb-reader when a user picks an .accdb file), so they stay
 * on Rollup's own dynamic boundary instead of the eager `vendor` chunk.
 */
const LAZY_PACKAGE_PATHS = Object.freeze([
  '/node_modules/xlsx/',
  '/node_modules/mdb-reader/',
  '/node_modules/buffer/',
  '/node_modules/pako/',
  '/node_modules/browserify-aes/',
  '/node_modules/create-hash/',
  '/node_modules/cipher-base/',
  '/node_modules/evp_bytestokey/',
  '/node_modules/md5.js/',
  '/node_modules/ripemd160/',
  '/node_modules/sha.js/',
  '/node_modules/hash-base/',
  '/node_modules/readable-stream/',
  '/node_modules/base64-js/',
  '/node_modules/ieee754/',
  '/node_modules/safe-buffer/',
  '/node_modules/inherits/',
]);

/**
 * Dependency-only partition. All src/ modules stay graph-owned: hand-drawn
 * core partitions created circular chunks (core-linear-fea <-> core-application)
 * in this smaller graph, which risks TDZ failures in the generated ESM.
 */
export function manualChunk(id) {
  const source = id.replaceAll('\\', '/');
  if (source.includes('vite/preload-helper')) return 'runtime';
  if (LAZY_PACKAGE_PATHS.some((p) => source.includes(p))) return undefined;
  if (source.includes('/node_modules/three/examples/')) return 'vendor-three-examples';
  if (source.includes('/node_modules/three/')) return 'vendor-three-core';
  if (source.includes('/node_modules/')) return 'vendor';
  return undefined;
}

export default defineConfig({
  base: '/LFEA/',
  plugins: [],
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    outDir: 'dist-lfea',
    emptyOutDir: true,
    modulePreload: false,
    manifest: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        lfea: fileURLToPath(new URL('./lfea.html', import.meta.url)),
      },
      output: {
        manualChunks: manualChunk,
        onlyExplicitManualChunks: false,
      },
    },
  },
  server: {
    open: '/LFEA/lfea.html',
    watch: {
      ignored: ['**/benchmarks/**', '**/reports/**', '**/playwright-report/**'],
    },
  },
});
