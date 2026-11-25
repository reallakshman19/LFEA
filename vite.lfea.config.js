// Kept for compatibility with AA3-era scripts (`vite build --config vite.lfea.config.js`).
// The LFEA app has a single build target; this delegates to vite.config.js.
import { defineConfig } from 'vite';
import baseConfig, { manualChunk } from './vite.config.js';

export { manualChunk };

export default defineConfig({
  ...baseConfig,
  base: '/Advanced_Analysis/',
});
