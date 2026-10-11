import { isDesktop } from '../lib/desktop';
import { canPopOut } from '../lib/widget';
import { useStore } from '../store';
import type { ClockVisibility, Settings } from '../types';

const CLOCK: { id: ClockVisibility; label: string }[] = [
  { id: 'always', label: 'Always' },
  { id: 'auto', label: 'When active' },
  { id: 'never', label: 'Never' },
];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function Pin({ label, k, hint }: { label: string; k: BoolKey; hint?: string }) {
  const v = useStore((s) => s.settings[k]);
  const update = useStore((s) => s.updateSettings);
  return (
    <label className="field toggle">
      <span>
        {label}
        {hint && <small className="muted">{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={v} onChange={(e) => update({ [k]: e.target.checked })} />
    </label>
  );
}

/** What focus view keeps on screen. Shared by Settings and the in-focus view panel. */
export function FocusOptions() {
  const clock = useStore((s) => s.settings.focusClock);
  const widget = useStore((s) => s.settings.widget);
  const update = useStore((s) => s.updateSettings);
  return (
    <div className="focus-options">
      <div className="field">
        <span>
          Clock
          <small className="muted">“When active” shows it only while you move the mouse or type</small>
        </span>
        <div className="segmented segmented-sm" role="radiogroup" aria-label="Clock visibility">
          {CLOCK.map((c) => (
            <button key={c.id} role="radio" aria-checked={clock === c.id} className={clock === c.id ? 'is-active' : ''} onClick={() => update({ focusClock: c.id })}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted focus-options-note">Anything not pinned stays hidden until you move the mouse, click, or press a key.</p>
      <Pin label="Pin dashboard button" k="focusPinDashboard" />
      <Pin label="Pin tool buttons" k="focusPinTools" hint="Sound, art, view, and fullscreen" />
      <Pin label="Pin timer controls" k="focusPinControls" />
      <Pin label="Progress bar" k="focusProgress" hint="Thin line along the bottom edge" />
      {isDesktop && <Pin label="Now playing" k="showNowPlaying" />}
      {(isDesktop || canPopOut) && widget !== 'off' && <Pin label="Clock in floating widget" k="widgetClock" hint="Off shows only progress and your task" />}
    </div>
  );
}
