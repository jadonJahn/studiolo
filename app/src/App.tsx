import { useEffect, useState } from 'react';
import { ArtCanvas } from './art/ArtCanvas';
import { APP_NAME } from './brand';
import { ART_STYLES } from './art/engine';
import { FocusView } from './components/FocusView';
import { Gallery } from './components/Gallery';
import { IconChart, IconGallery, IconSettings, IconTasks, IconTimer } from './components/icons';
import { Settings } from './components/Settings';
import { Stats } from './components/Stats';
import { Tasks } from './components/Tasks';
import { TimerHome } from './components/TimerHome';
import { useAchievements, useAmbient, useTimerDriver } from './hooks';
import { finishSegment, startTimer } from './lib/actions';
import { useStore, useUI } from './store';

type View = 'timer' | 'tasks' | 'stats' | 'gallery' | 'settings';

const NAV: { id: View; label: string; Icon: typeof IconTimer }[] = [
  { id: 'timer', label: 'Timer', Icon: IconTimer },
  { id: 'tasks', label: 'Tasks', Icon: IconTasks },
  { id: 'stats', label: 'Stats', Icon: IconChart },
  { id: 'gallery', label: 'Gallery', Icon: IconGallery },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
];

export default function App() {
  const [view, setView] = useState<View>('timer');
  const focus = useUI((s) => s.focus);
  const setFocus = useUI((s) => s.setFocus);
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  const accent = useStore((s) => s.activities.find((a) => a.id === s.timer.activityId)?.color ?? '#8b83ff');

  useTimerDriver();
  useAmbient();
  useAchievements();

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  // Stats/tasks/etc. sit on blurred glass over the art; re-blurring a moving
  // canvas every frame is the most expensive thing the app could do, so freeze it.
  useEffect(() => {
    useUI.getState().setArtPaused(!focus && view !== 'timer');
  }, [focus, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const st = useStore.getState();
      const t = st.timer;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (t.status === 'running') st.pause();
          else startTimer();
          break;
        case 'r':
        case 'R':
          st.reset();
          break;
        case 's':
        case 'S':
          if (t.status === 'idle' && t.mode === 'pomodoro') st.skip();
          else if (t.status !== 'idle') finishSegment();
          break;
        case 'f':
        case 'F':
          setFocus(!useUI.getState().focus);
          break;
        case 'a':
        case 'A': {
          const i = ART_STYLES.findIndex((a) => a.id === t.artStyle);
          st.setArtStyle(ART_STYLES[(i + 1) % ART_STYLES.length].id);
          break;
        }
        case 'Escape':
          setFocus(false);
          break;
        default:
          if (!useUI.getState().focus && /^[1-5]$/.test(e.key)) setView(NAV[+e.key - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFocus]);

  return (
    <>
      <ArtCanvas />
      <div className={`scrim ${focus ? 'is-focus' : view === 'timer' ? 'is-home' : ''}`} />
      {focus ? (
        <FocusView />
      ) : (
        <div className="shell">
          <nav className="nav">
            <div className="brand">
              <img src="/icon.svg" alt="" width={28} height={28} />
              <span>{APP_NAME}</span>
            </div>
            <ul>
              {NAV.map(({ id, label, Icon }) => (
                <li key={id}>
                  <button className={view === id ? 'is-active' : ''} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}>
                    <Icon />
                    <span>{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <main className="main">
            {view === 'timer' && <TimerHome />}
            {view === 'tasks' && (
              <Tasks
                onStart={() => {
                  setView('timer');
                  startTimer();
                }}
              />
            )}
            {view === 'stats' && <Stats />}
            {view === 'gallery' && <Gallery />}
            {view === 'settings' && <Settings />}
          </main>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className="toast glass" onClick={() => dismiss(t.id)}>
            {t.icon && <span className="toast-icon">{t.icon}</span>}
            <span>
              <strong>{t.title}</strong>
              {t.body && <span className="toast-body">{t.body}</span>}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
