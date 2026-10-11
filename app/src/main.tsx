import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { WidgetWindow } from './components/WidgetWindow';
import { timerTick } from './hooks';
import { initDesktop, isDesktop } from './lib/desktop';
import { isWidgetWindow } from './lib/env';
import { initMusic } from './lib/music';
import { initWidgetHost } from './lib/widget';
import './styles.css';

if (isWidgetWindow) {
  // The floating widget only mirrors state pushed from the main window.
} else if (isDesktop) {
  await initDesktop(timerTick);
  await initMusic();
  await initWidgetHost();
} else {
  // Installable PWA only in the browser; the desktop shell ships its own assets.
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({ immediate: true });
}

if (import.meta.env.DEV && !isWidgetWindow) {
  void import('./store').then(({ useStore, useUI }) => Object.assign(window, { __flow: useStore, __ui: useUI }));
  void import('./lib/music').then(({ audioFrame, useMusic }) => Object.assign(window, { __audio: audioFrame, __music: useMusic }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isWidgetWindow ? <WidgetWindow /> : <App />}</StrictMode>,
);
