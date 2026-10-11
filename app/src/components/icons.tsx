import type { SVGProps } from 'react';

const base = (d: string | string[], props: SVGProps<SVGSVGElement>, fill = false) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {(Array.isArray(d) ? d : [d]).map((p, i) => (
      <path key={i} d={p} />
    ))}
  </svg>
);

type P = SVGProps<SVGSVGElement>;
export const IconPlay = (p: P) => base('M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z', p, true);
export const IconPause = (p: P) => base(['M8 5h2.5v14H8z', 'M13.5 5H16v14h-2.5z'], p, true);
export const IconReset = (p: P) => base(['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'], p);
export const IconSkip = (p: P) => base(['M5 5l10 7-10 7z', 'M19 5v14'], p);
export const IconStop = (p: P) => base('M7 7h10v10H7z', p);
export const IconExpand = (p: P) => base(['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'], p);
export const IconClose = (p: P) => base(['M6 6l12 12', 'M18 6L6 18'], p);
export const IconBack = (p: P) => base(['M15 18l-6-6 6-6'], p);
export const IconPlus = (p: P) => base(['M12 5v14', 'M5 12h14'], p);
export const IconTrash = (p: P) => base(['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'], p);
export const IconDownload = (p: P) => base(['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'], p);
export const IconTimer = (p: P) => base(['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 9v4l2.5 2.5', 'M9 2h6'], p);
export const IconTasks = (p: P) => base(['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6l1 1 2-2', 'M4 12l1 1 2-2', 'M4 18l1 1 2-2'], p);
export const IconChart = (p: P) => base(['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'], p);
export const IconGallery = (p: P) => base(['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9.5a1.5 1.5 0 1 0 0-.01'], p);
export const IconSettings = (p: P) =>
  base(
    [
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    ],
    p,
  );
export const IconFullscreen = (p: P) => base(['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'], p);
export const IconPalette = (p: P) =>
  base(['M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21z', 'M7.5 11.5h.01', 'M10.5 7.5h.01', 'M15.5 8.5h.01'], p);
export const IconSound = (p: P) => base(['M11 5L6 9H3v6h3l5 4z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'], p);
export const IconEye = (p: P) => base(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], p);
export const IconPopOut = (p: P) => base(['M14 4h6v6', 'M20 4l-8 8', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'], p);
