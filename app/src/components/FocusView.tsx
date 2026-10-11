import { useEffect, useState } from 'react';
import { ART_STYLES } from '../art/engine';
import { PALETTES } from '../art/palettes';
import { useIdle, useNow, useWakeLock } from '../hooks';
import { elapsedMs, fmtClock, MIN, phaseLabel, targetMs } from '../lib/time';
import { useStore, useUI } from '../store';
import type { AmbientKind } from '../types';
import { Controls, } from './Controls';
import { CycleDots } from './TimerHome';
import { MusicControls, NowPlayingChip } from './Music';
import { isDesktop } from '../lib/desktop';
import { canPopOut, popOutWidget } from '../lib/widget';
import { FocusOptions } from './FocusOptions';
import { IconBack, IconEye, IconFullscreen, IconPalette, IconPopOut, IconSound } from './icons';

const AMBIENTS: { id: AmbientKind; label: string }[] = [
  { id: 'off', label: 'Silence' },
  { id: 'rain', label: 'Rain' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'brown', label: 'Brown noise' },
  { id: 'pink', label: 'Pink noise' },
  { id: 'white', label: 'White noise' },
  { id: 'drone', label: 'Drone' },
];

export function FocusView() {
  const now = useNow(200);
  const t = useStore((s) => s.timer);
  const settings = useStore((s) => s.settings);
  const activity = useStore((s) => s.activities.find((a) => a.id === s.timer.activityId));
  const task = useStore((s) => s.tasks.find((k) => k.id === s.timer.taskId));
  const { setArtStyle, updateSettings } = useStore.getState();
  const setFocus = useUI((s) => s.setFocus);
  const [panel, setPanel] = useState<'none' | 'art' | 'sound' | 'view'>('none');

  const running = t.status === 'running';
  // Unpinned UI shows while you're active and fades after a few quiet seconds.
  const idle = useIdle(3000, panel === 'none');
  useWakeLock(running);

  const target = targetMs(t, settings);
  const el = elapsedMs(t, now);
  const isStopwatch = t.mode === 'stopwatch';
  const progress = isStopwatch ? Math.min(1, el / (settings.focusMin * MIN)) : target ? Math.min(1, el / target) : 0;

  // Leaving focus view also leaves fullscreen.
  useEffect(
    () => () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    },
    [],
  );

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  const hideCenter = settings.focusClock === 'auto' && idle;
  const pin = (on: boolean) => `chrome ${on ? 'is-pinned' : ''}`;

  return (
    <div className={`focus ${idle ? 'is-idle' : ''}`}>
      <header className="focus-top">
        <button className={`btn-ghost ${pin(settings.focusPinDashboard)}`} onClick={() => setFocus(false)} title="Exit focus view (Esc)">
          <IconBack /> Dashboard
        </button>
        <div className={`focus-tools ${pin(settings.focusPinTools)}`}>
          <button className={`btn-icon ${panel === 'view' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'view' ? 'none' : 'view')} title="What stays on screen" aria-label="Focus view options">
            <IconEye />
          </button>
          <button className={`btn-icon ${panel === 'sound' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'sound' ? 'none' : 'sound')} title="Ambient sound" aria-label="Ambient sound">
            <IconSound />
          </button>
          <button className={`btn-icon ${panel === 'art' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'art' ? 'none' : 'art')} title="Art style (A)" aria-label="Art style">
            <IconPalette />
          </button>
          {canPopOut && (
            <button className="btn-icon" onClick={() => void popOutWidget()} title="Pop out a mini timer that stays on top" aria-label="Pop out mini timer">
              <IconPopOut />
            </button>
          )}
          <button className="btn-icon" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
            <IconFullscreen />
          </button>
        </div>
      </header>

      {panel === 'art' && (
        <div className="focus-panel glass">
          <h4>Art style</h4>
          <div className="style-grid">
            {ART_STYLES.map((a) => (
              <button key={a.id} className={`style-card ${t.artStyle === a.id ? 'is-active' : ''}`} onClick={() => setArtStyle(a.id)}>
                <strong>{a.name}</strong>
                <span>{a.blurb}</span>
              </button>
            ))}
          </div>
          <h4>Palette</h4>
          <div className="palette-row">
            <button className={`swatch-btn ${settings.palette === 'activity' ? 'is-active' : ''}`} onClick={() => updateSettings({ palette: 'activity' })}>
              By activity
            </button>
            {PALETTES.filter((pl) => !pl.id.startsWith("np:")).map((p) => (
              <button
                key={p.id}
                className={`swatch-btn ${settings.palette === p.id ? 'is-active' : ''}`}
                onClick={() => updateSettings({ palette: p.id })}
                title={p.name}
                aria-label={p.name}
              >
                <span className="swatch" style={{ background: `linear-gradient(90deg, ${p.colors.join(',')})` }} />
              </button>
            ))}
          </div>
          <label className="slider-row">
            <span>Motion</span>
            <input type="range" min={0.2} max={2} step={0.05} value={settings.artMotion} onChange={(e) => updateSettings({ artMotion: +e.target.value })} />
          </label>
        </div>
      )}

      {panel === 'view' && (
        <div className="focus-panel glass">
          <h4>On screen</h4>
          <FocusOptions />
        </div>
      )}

      {panel === 'sound' && (
        <div className="focus-panel glass">
          <h4>Ambient sound <span className="muted">plays while focusing</span></h4>
          <div className="chips">
            {AMBIENTS.map((a) => (
              <button key={a.id} className={`chip ${settings.ambient === a.id ? 'is-active' : ''}`} onClick={() => updateSettings({ ambient: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
          <label className="slider-row">
            <span>Volume</span>
            <input type="range" min={0} max={1} step={0.01} value={settings.ambientVolume} onChange={(e) => updateSettings({ ambientVolume: +e.target.value })} />
          </label>
          {isDesktop && (
            <>
              <h4 className="panel-gap">Music visualizer</h4>
              <MusicControls />
            </>
          )}
        </div>
      )}

      <div className={`focus-center ${hideCenter ? 'is-hidden' : ''}`}>
        <div className="focus-meta">
          {activity && (
            <span>
              {activity.emoji} {activity.name}
            </span>
          )}
          <span className="sep">·</span>
          <span>{phaseLabel(t)}</span>
          {t.mode === 'pomodoro' && (
            <>
              <span className="sep">·</span>
              <CycleDots />
            </>
          )}
        </div>
        {settings.focusClock !== 'never' && <div className="focus-time">{isStopwatch ? fmtClock(el, true) : fmtClock(target - el)}</div>}
        {(t.intent || task) && <div className="focus-intent">{t.intent || task?.title}</div>}
        {t.status === 'paused' && <div className="focus-paused">Paused</div>}
      </div>

      <footer className={`focus-bottom ${pin(settings.focusPinControls)}`}>
        <Controls size="lg" />
      </footer>
      <div className="focus-np">
        <NowPlayingChip />
      </div>
      {settings.focusProgress && <div className="focus-progress" style={{ transform: `scaleX(${progress})` }} />}
    </div>
  );
}
