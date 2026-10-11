import { useEffect, useRef, type PointerEvent } from 'react';
import { ArtCanvas } from '../art/ArtCanvas';
import { APP_NAME } from '../brand';
import { useNow } from '../hooks';
import { elapsedMs, fmtClock, phaseLabel, targetMs } from '../lib/time';
import type { WidgetCommand, WidgetLayout } from '../lib/widget';
import { useStore } from '../store';
import { IconClose, IconExpand, IconPause, IconPlay, IconSkip, IconStop } from './icons';

interface Props {
  layout: WidgetLayout;
  onCommand(cmd: WidgetCommand): void;
  /** Desktop: drag the frameless window by its body. */
  onDragStart?(): void;
  /** Open/close buttons; picture-in-picture windows bring their own. */
  windowControls?: boolean;
}

/** Glanceable timer that floats over other windows while you work. */
export function Widget({ layout, onCommand, onDragStart, windowControls = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(250);
  const t = useStore((s) => s.timer);
  const s = useStore((st) => st.settings);
  const accent = useStore((st) => st.activities.find((a) => a.id === st.timer.activityId)?.color ?? '#8b83ff');
  const label = useStore(
    (st) => st.tasks.find((k) => k.id === st.timer.taskId)?.title || st.timer.intent || st.activities.find((a) => a.id === st.timer.activityId)?.name || '',
  );

  // The widget may live in another document (picture-in-picture), so set the accent there.
  useEffect(() => {
    ref.current?.ownerDocument.documentElement.style.setProperty('--accent', accent);
  }, [accent]);

  const target = targetMs(t, s);
  const el = elapsedMs(t, now);
  const clock = t.mode === 'stopwatch' ? fmtClock(el, true) : fmtClock(target - el);
  const progress = target ? Math.min(1, el / target) : 0;
  const running = t.status === 'running';
  const phase =
    t.mode === 'pomodoro' && t.phase === 'focus' ? `Focus · ${(t.cycle % s.longEvery) + 1}/${s.longEvery}` : phaseLabel(t);
  const canSkip = t.status === 'idle' && t.mode === 'pomodoro';
  const nextDisabled = t.status === 'idle' && !canSkip;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 0 && !(e.target as Element).closest('button')) onDragStart?.();
  };

  const toggle = (
    <button className="widget-btn is-primary" onClick={() => onCommand('toggle')} aria-label={running ? 'Pause' : t.status === 'paused' ? 'Resume' : 'Start'} title={running ? 'Pause' : 'Start'}>
      {running ? <IconPause /> : <IconPlay />}
    </button>
  );
  const next = (
    <button className="widget-btn" onClick={() => onCommand('next')} disabled={nextDisabled} aria-label={canSkip ? 'Skip' : 'Finish'} title={canSkip ? 'Skip' : 'End and log'}>
      {canSkip ? <IconSkip /> : <IconStop />}
    </button>
  );
  const open = windowControls && (
    <button className="widget-btn" onClick={() => onCommand('open')} aria-label={`Open ${APP_NAME}`} title={`Open ${APP_NAME}`}>
      <IconExpand />
    </button>
  );
  const close = windowControls && (
    <button className="widget-btn widget-close" onClick={() => onCommand('close')} aria-label="Hide widget" title="Hide until you come back">
      <IconClose />
    </button>
  );
  const bar = (
    <span className="widget-bar" aria-hidden="true">
      <span style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
    </span>
  );
  const showClock = s.widgetClock;
  const cls = `widget widget-${layout} ${showClock ? '' : 'no-clock'} ${running ? 'is-running' : t.status === 'paused' ? 'is-paused' : 'is-idle'}`;

  if (layout === 'pill') {
    return (
      <div ref={ref} className={cls} onPointerDown={onPointerDown}>
        <span className="widget-dot" aria-hidden="true" />
        {showClock && <span className="widget-clock">{clock}</span>}
        <span className="widget-label" title={label}>
          {t.status === 'idle' ? phase : label || phase}
        </span>
        {bar}
        {toggle}
        {open}
        {close}
      </div>
    );
  }

  return (
    <div ref={ref} className={cls} onPointerDown={onPointerDown}>
      <ArtCanvas widget />
      <div className="widget-shade" />
      <div className="widget-body">
        <div className="widget-top">
          <span className="widget-phase">
            <span className="widget-dot" aria-hidden="true" />
            {phase}
            {t.status === 'paused' && ' · paused'}
          </span>
          {close}
        </div>
        {showClock && <span className="widget-clock">{clock}</span>}
        <span className="widget-label" title={label}>
          {label}
        </span>
        {bar}
        <div className="widget-controls">
          {toggle}
          {next}
          <span className="widget-spacer" />
          {open}
        </div>
      </div>
    </div>
  );
}
