import { useEffect, useRef, useState } from 'react';
import { ART_STYLES } from '../art/engine';
import { PALETTES } from '../art/palettes';
import { APP_NAME, APP_VERSION, REPO_URL } from '../brand';
import { clearErrorLog, diagnostics } from '../lib/diagnostics';
import { openExternal } from '../lib/links';
import { canUpdate, checkForUpdate } from '../lib/updates';
import { ext } from '../extensions';
import { isDesktop, setApiEnabled, type ApiInfo } from '../lib/desktop';
import { chime, previewAmbient } from '../lib/sound';
import { canPopOut } from '../lib/widget';
import { useStore, useUI, type ExportData } from '../store';
import type { Activity, AmbientKind, Settings as S } from '../types';
import { FocusOptions } from './FocusOptions';
import { IconPlus, IconTrash } from './icons';
import { MusicControls } from './Music';

function Num({ label, k, min, max, suffix = 'min' }: { label: string; k: keyof S; min: number; max: number; suffix?: string }) {
  const v = useStore((s) => s.settings[k]) as number;
  const update = useStore((s) => s.updateSettings);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          value={draft ?? v}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Math.round(Number(draft));
            if (draft !== null && Number.isFinite(n)) update({ [k]: Math.min(max, Math.max(min, n)) } as Partial<S>);
            setDraft(null);
          }}
        />
        <span className="muted">{suffix}</span>
      </span>
    </label>
  );
}

function Toggle({ label, k, hint, onEnable }: { label: string; k: keyof S; hint?: string; onEnable?(): Promise<boolean> }) {
  const v = useStore((s) => s.settings[k]) as boolean;
  const update = useStore((s) => s.updateSettings);
  return (
    <label className="field toggle">
      <span>
        {label}
        {hint && <small className="muted">{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={v}
        onChange={async (e) => {
          const on = e.target.checked;
          if (on && onEnable && !(await onEnable())) return;
          update({ [k]: on } as Partial<S>);
        }}
      />
    </label>
  );
}

const AMBIENTS: { id: AmbientKind; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'rain', label: 'Rain' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'brown', label: 'Brown noise' },
  { id: 'pink', label: 'Pink noise' },
  { id: 'white', label: 'White noise' },
  { id: 'drone', label: 'Drone' },
];

export function Settings() {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const toast = useUI((u) => u.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      toast({ title: 'Notifications unsupported', body: 'This browser does not support them.' });
      return false;
    }
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (p !== 'granted') toast({ title: 'Notifications blocked', body: 'Allow them in your browser settings.' });
    return p === 'granted';
  };

  const exportData = () => {
    const st = useStore.getState();
    const data: ExportData = { version: 1, settings: st.settings, activities: st.activities, tasks: st.tasks, sessions: st.sessions, unlocked: st.unlocked };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${APP_NAME.toLowerCase()}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importData = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as ExportData;
      if (!d || d.version !== 1 || !Array.isArray(d.sessions)) throw new Error(`Not a ${APP_NAME} backup`);
      if (!confirm(`Replace current data with backup (${d.sessions.length} sessions)?`)) return;
      useStore.getState().importData(d);
      toast({ icon: '✅', title: 'Backup restored' });
    } catch (e) {
      toast({ icon: '⚠️', title: 'Import failed', body: (e as Error).message });
    }
  };

  return (
    <section className="page settings">
      <h1>Settings</h1>

      <div className="card glass">
        <h3>Timer</h3>
        <div className="grid2">
          <Num label="Focus" k="focusMin" min={1} max={240} />
          <Num label="Short break" k="shortMin" min={1} max={60} />
          <Num label="Long break" k="longMin" min={1} max={120} />
          <Num label="Long break every" k="longEvery" min={2} max={12} suffix="blocks" />
          <Num label="Daily goal" k="dailyGoalMin" min={10} max={960} />
          <Num label="Minimum to log" k="minLogMin" min={0} max={30} />
        </div>
        <Toggle label="Auto-start breaks" k="autoStartBreaks" />
        <Toggle label="Auto-start focus after breaks" k="autoStartFocus" />
        <Toggle label="Open focus view on start" k="autoFocusView" />
        <Toggle label="Week starts Monday" k="weekStartsMonday" />
        {isDesktop && (
          <Toggle
            label="Keep running in the tray when closed"
            k="closeToTray"
            hint={`Timers, the floating widget and the local API keep going. Quit from the tray icon. Off: closing the window quits ${APP_NAME}.`}
          />
        )}
        {(isDesktop || canPopOut) && (
          <label className="field">
            <span>
              Floating widget
              <small className="muted">
                {isDesktop ? 'Stays on top of other windows while a session runs' : 'Pop it out from focus view to keep the timer on top'}
              </small>
            </span>
            <select className="input" value={s.widget} onChange={(e) => update({ widget: e.target.value as S['widget'] })}>
              <option value="card">Card with art</option>
              <option value="pill">Compact bar</option>
              {isDesktop && <option value="off">Off</option>}
            </select>
          </label>
        )}
      </div>

      <div className="card glass">
        <h3>Focus view</h3>
        <FocusOptions />
      </div>

      <div className="card glass">
        <h3>Art</h3>
        <label className="field">
          <span>Style for new sessions</span>
          <select className="input" value={s.artStyle} onChange={(e) => update({ artStyle: e.target.value as S['artStyle'] })}>
            <option value="random">Surprise me</option>
            {ART_STYLES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Palette</span>
          <select className="input" value={s.palette} onChange={(e) => update({ palette: e.target.value })}>
            <option value="activity">Match activity</option>
            {PALETTES.filter((pl) => !pl.id.startsWith("np:")).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Motion</span>
          <input type="range" min={0.2} max={2} step={0.05} value={s.artMotion} onChange={(e) => update({ artMotion: +e.target.value })} />
        </label>
        <Toggle label="Save finished pieces to gallery" k="saveArt" />
      </div>

      <div className="card glass">
        <h3>Sound & alerts</h3>
        <Toggle label="Chime when a segment ends" k="chime" />
        <label className="field">
          <span>Chime volume</span>
          <input type="range" min={0} max={1} step={0.01} value={s.volume} onChange={(e) => update({ volume: +e.target.value })} onMouseUp={() => chime(s.volume)} onTouchEnd={() => chime(s.volume)} />
        </label>
        <label className="field">
          <span>Ambient sound while focusing</span>
          <select
            className="input"
            value={s.ambient}
            onChange={(e) => {
              const k = e.target.value as AmbientKind;
              update({ ambient: k });
              previewAmbient(k, s.ambientVolume);
            }}
          >
            {AMBIENTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ambient volume</span>
          <input type="range" min={0} max={1} step={0.01} value={s.ambientVolume} onChange={(e) => update({ ambientVolume: +e.target.value })} onMouseUp={() => previewAmbient(s.ambient, s.ambientVolume)} />
        </label>
        <Toggle label="Desktop notifications" k="notifications" hint="When the tab is in the background" onEnable={requestNotifications} />
      </div>

      {isDesktop && (
        <div className="card glass">
          <h3>Music visualizer</h3>
          <MusicControls />
        </div>
      )}

      <Activities />

      <Sharing />

      <div className="card glass">
        <h3>Data</h3>
        <p className="muted small">Everything is stored locally in this browser. Export a backup to move it elsewhere.</p>
        <div className="row">
          <button className="btn-ghost" onClick={exportData}>
            Export backup
          </button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
          <button
            className="btn-ghost danger"
            onClick={() => {
              if (confirm('Erase all sessions, tasks and settings? Gallery images are kept. This cannot be undone.')) useStore.getState().resetAll();
            }}
          >
            Reset everything
          </button>
        </div>
      </div>

      <About />

      <div className="card glass">
        <h3>Keyboard</h3>
        <ul className="keys">
          <li><kbd>Space</kbd> start / pause</li>
          <li><kbd>R</kbd> reset</li>
          <li><kbd>S</kbd> skip / end early</li>
          <li><kbd>F</kbd> focus view</li>
          <li><kbd>A</kbd> next art style</li>
          <li><kbd>Esc</kbd> leave focus view</li>
          <li><kbd>1</kbd>–<kbd>5</kbd> switch pages</li>
        </ul>
      </div>
    </section>
  );
}

function Copyable({ text }: { text: string }) {
  const toast = useUI((u) => u.toast);
  return (
    <button
      className="copyable"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        toast({ icon: '📋', title: 'Copied' });
      }}
    >
      <code>{text}</code>
    </button>
  );
}

/** Desktop only: where the SQLite mirror lives, and the optional read-only API over it. */
function Sharing() {
  const on = useStore((s) => s.settings.localApi);
  const [info, setInfo] = useState<ApiInfo | null>(null);
  useEffect(() => {
    if (isDesktop) void setApiEnabled(on).then(setInfo);
  }, [on]);
  if (!isDesktop) return null;
  const local = info?.port ? `http://127.0.0.1:${info.port}` : null;
  const tn = ext.tailnet;
  return (
    <div className="card glass">
      <h3>Data &amp; API</h3>
      <p className="muted small">
        Sessions, tasks and the live timer are mirrored to a SQLite database on this PC, so your history survives if the app&apos;s
        storage is cleared.
      </p>
      <Toggle
        label="Local data API"
        k="localApi"
        hint="Serve your data read-only at 127.0.0.1 for scripts and automations. Any program on this PC can read it while it's on."
      />
      <div className="share-rows">
        <span className="muted">Database</span>
        <Copyable text={info?.db_path ?? '…'} />
        {on && (
          <>
            <span className="muted">Local API</span>
            {local ? <Copyable text={`${local}/api`} /> : <span className="danger-text">not running (ports 47800–47809 busy)</span>}
          </>
        )}
        {on && local && tn && (
          <>
            <span className="muted">Share once</span>
            <Copyable text={`tailscale serve --bg --https=${tn.port} ${local}`} />
            <span className="muted">Tailnet URL</span>
            <Copyable text={`https://${tn.host}:${tn.port}/api`} />
          </>
        )}
      </div>
      {on && tn && <p className="muted small">{tn.note}</p>}
    </div>
  );
}

function About() {
  const toast = useUI((u) => u.toast);
  const update = useUI((u) => u.update);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const u = await checkForUpdate();
      if (!u) toast({ icon: '✅', title: "You're up to date", body: `${APP_NAME} ${APP_VERSION}` });
    } catch (e) {
      toast({ icon: '⚠️', title: "Couldn't check for updates", body: String(e) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="card glass">
      <h3>
        About <span className="muted small">{APP_NAME} {APP_VERSION}</span>
      </h3>
      <p className="muted small">
        Found a bug? Copy the diagnostics (version, settings, and recent errors; never your sessions or tasks) and paste them into a
        new issue.
      </p>
      <div className="about-actions">
        {canUpdate &&
          (update ? (
            <button className="btn-primary" onClick={() => void update.install()}>
              Install {update.version} and restart
            </button>
          ) : (
            <button className="btn-ghost" onClick={() => void check()} disabled={checking}>
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          ))}
        <button
          className="btn-ghost"
          onClick={() => {
            void navigator.clipboard.writeText(diagnostics());
            toast({ icon: '📋', title: 'Diagnostics copied' });
          }}
        >
          Copy diagnostics
        </button>
        <button className="btn-ghost" onClick={() => void openExternal(`${REPO_URL}/issues/new/choose`)}>
          Report a bug
        </button>
        <button className="btn-ghost" onClick={() => void openExternal(REPO_URL)}>
          Source code
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            clearErrorLog();
            toast({ title: 'Error log cleared' });
          }}
        >
          Clear error log
        </button>
      </div>
    </div>
  );
}

function Activities() {
  const activities = useStore((s) => s.activities);
  const { addActivity, updateActivity, removeActivity } = useStore.getState();
  const visible = activities.filter((a) => !a.archived);

  const row = (a: Activity) => (
    <li key={a.id} className="act-row">
      <input className="input emoji" value={a.emoji} onChange={(e) => updateActivity(a.id, { emoji: e.target.value.slice(0, 4) })} aria-label="Emoji" />
      <input className="input grow" value={a.name} onChange={(e) => updateActivity(a.id, { name: e.target.value })} aria-label="Name" maxLength={30} />
      <input className="color" type="color" value={a.color} onChange={(e) => updateActivity(a.id, { color: e.target.value })} aria-label="Color" />
      <select className="input" value={a.palette} onChange={(e) => updateActivity(a.id, { palette: e.target.value })} aria-label="Art palette">
        {PALETTES.filter((pl) => !pl.id.startsWith("np:")).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="btn-icon btn-sm danger" onClick={() => visible.length > 1 && removeActivity(a.id)} disabled={visible.length <= 1} aria-label={`Remove ${a.name}`}>
        <IconTrash />
      </button>
    </li>
  );

  return (
    <div className="card glass">
      <h3>Activities</h3>
      <ul className="act-list">{visible.map(row)}</ul>
      <button
        className="btn-ghost"
        onClick={() => {
          const p = PALETTES[Math.floor(Math.random() * PALETTES.length)];
          addActivity({ name: 'New activity', emoji: '✨', color: p.colors[2], palette: p.id });
        }}
      >
        <IconPlus /> Add activity
      </button>
    </div>
  );
}
