import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tauriConf from './src-tauri/tauri.conf.json';

// The app's display name has one source: productName in the Tauri config.
const APP_NAME: string = tauriConf.productName;

export default defineConfig({
  define: { 'import.meta.env.VITE_APP_NAME': JSON.stringify(APP_NAME) },
  plugins: [
    react(),
    { name: 'app-name', transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME) },
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: 'Focus timer that paints generative art while you work.',
        theme_color: '#07070f',
        background_color: '#07070f',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: { port: 5178, strictPort: true },
  clearScreen: false,
});
