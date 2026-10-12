import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The production Nginx config exposes this dashboard at /admin/.
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 3000,
  },
});
