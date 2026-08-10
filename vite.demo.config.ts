import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { naveboxPlugin } from './src/vite-plugin';

export default defineConfig({
  plugins: [react(), naveboxPlugin()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
