import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Three.js por sí solo ronda los 600 kB minificado.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Three.js va en su propio archivo: no cambia entre versiones del juego,
        // así que el navegador lo guarda y no lo vuelve a descargar.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
