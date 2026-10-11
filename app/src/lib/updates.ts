import { ext } from '../extensions';
import { useUI } from '../store';
import { isDesktop } from './desktop';

export interface Update {
  version: string;
  notes?: string;
  /** Download, install, and restart into the new version. */
  install(): Promise<void>;
}

/** Desktop builds from the public releases update themselves; everything else never checks. */
export const canUpdate = isDesktop && ext.updates !== false;

export async function checkForUpdate(): Promise<Update | null> {
  if (!canUpdate) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  const update: Update = {
    version: u.version,
    notes: u.body,
    install: async () => {
      await u.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
  useUI.getState().setUpdate(update);
  return update;
}

/** One quiet check shortly after launch; failures (offline, no release yet) are ignored. */
export function checkForUpdateSoon() {
  if (!canUpdate) return;
  setTimeout(() => checkForUpdate().catch((e) => console.warn('Update check failed', e)), 8000);
}
