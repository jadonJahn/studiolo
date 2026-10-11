import { useCallback, useEffect, useState } from 'react';
import { isDesktop } from '../lib/desktop';
import { listSources, useMusic, type AudioSource } from '../lib/music';
import { useStore } from '../store';
import { APP_NAME } from '../brand';

/** Source picker + reactivity settings. Renders nothing in the browser build. */
export function MusicControls() {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const { capturing, error, hearing } = useMusic();
  const [sources, setSources] = useState<AudioSource[]>([]);

  const refresh = useCallback(() => {
    listSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);
  useEffect(() => {
    if (!isDesktop) return;
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!isDesktop) return null;

  // Keep the saved choice listed even when that app isn't currently making sound.
  const options = [...sources];
  if (s.musicSource !== 'all' && !options.some((o) => o.exe.toLowerCase() === s.musicSource.toLowerCase())) {
    options.push({ exe: s.musicSource, name: `${s.musicSource.replace(/\.exe$/i, '')} (not playing)`, peak: 0 });
  }

  const status = !s.musicReactive
    ? null
    : error
      ? { cls: 'danger-text', text: error }
      : capturing && hearing
        ? { cls: 'ok-text', text: `Listening to ${capturing}` }
        : capturing
          ? { cls: 'muted', text: `Listening to ${capturing} — nothing audible yet` }
          : { cls: 'muted', text: 'Starting…' };

  return (
    <div className="music-controls">
      <label className="field toggle">
        <span>
          React to music
          <small className="muted">Art moves with whatever is playing</small>
        </span>
        <input type="checkbox" role="switch" checked={s.musicReactive} onChange={(e) => update({ musicReactive: e.target.checked })} />
      </label>
      <label className="field">
        <span>Listen to</span>
        <select className="input" value={s.musicSource} onChange={(e) => update({ musicSource: e.target.value })} disabled={!s.musicReactive}>
          <option value="all">All audio (except {APP_NAME})</option>
          {options.map((o) => (
            <option key={o.exe} value={o.exe}>
              {o.name}
              {o.peak > 0.01 ? ' ♪' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Intensity</span>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={s.musicIntensity}
          onChange={(e) => update({ musicIntensity: +e.target.value })}
          disabled={!s.musicReactive}
        />
      </label>
      <label className="field toggle">
        <span>
          Palette from album art
          <small className="muted">Recolors the art for each track</small>
        </span>
        <input type="checkbox" role="switch" checked={s.albumPalette} onChange={(e) => update({ albumPalette: e.target.checked })} />
      </label>
      <label className="field toggle">
        <span>Show now playing</span>
        <input type="checkbox" role="switch" checked={s.showNowPlaying} onChange={(e) => update({ showNowPlaying: e.target.checked })} />
      </label>
      {status && <p className={`small ${status.cls}`}>{status.text}</p>}
    </div>
  );
}

export function NowPlayingChip({ compact }: { compact?: boolean }) {
  const np = useMusic((m) => m.nowPlaying);
  const show = useStore((s) => s.settings.showNowPlaying);
  if (!isDesktop || !show || !np) return null;
  return (
    <div className={`now-playing glass ${compact ? 'is-compact' : ''} ${np.playing ? '' : 'is-paused'}`} title={`${np.title} — ${np.artist} (${np.app})`}>
      {np.art ? <img src={np.art} alt="" /> : <span className="np-art-fallback">♪</span>}
      <span className="np-text">
        <strong>{np.title}</strong>
        <span>
          {np.artist || np.app}
          {!np.playing && ' · paused'}
        </span>
      </span>
      {np.playing && (
        <span className="np-eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}
