/**
 * Hooks for a private build. `src/private/index.ts` exists only in the owner's
 * private repo; the public repo ships without it, so everything here is empty.
 */
export interface Extensions {
  /** Start the local data API by default instead of leaving it off. */
  localApiDefault?: boolean;
  /** Set to false for builds that aren't shipped through the public releases, so they never self-update. */
  updates?: boolean;
  /** Show copy-ready commands and URLs for sharing the API over a tailnet. */
  tailnet?: { host: string; port: number; note: string };
}

const found = import.meta.glob<{ default: Extensions }>('./private/index.ts', { eager: true });

export const ext: Extensions = Object.values(found)[0]?.default ?? {};
