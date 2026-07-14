import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // A stricter compressed-size gate runs after every production build.
    chunkSizeWarningLimit: 550,
  },
  server: {
    port: 5174,
    strictPort: false,
  },
});
