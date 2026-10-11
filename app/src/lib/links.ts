import { isDesktop } from './desktop';

/** Open a web page in the user's browser (the desktop webview can't navigate away). */
export async function openExternal(url: string) {
  if (isDesktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
