import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appVersion } from './scripts/version.ts';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
});
