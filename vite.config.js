import { defineConfig } from 'vite';

export default defineConfig({
  // Three.js por sí solo ronda los 600 kB minificado.
  build: { chunkSizeWarningLimit: 1000 },
});
