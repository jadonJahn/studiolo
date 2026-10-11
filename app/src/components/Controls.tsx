import { finishSegment, startTimer } from '../lib/actions';
import { useStore } from '../store';
import { IconPause, IconPlay, IconReset, IconSkip, IconStop } from './icons';

export function Controls({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const status = useStore((s) => s.timer.status);
  const mode = useStore((s) => s.timer.mode);
  const phase = useStore((s) => s.timer.phase);
  const { pause, reset, skip } = useStore.getState();
  const active = status !== 'idle';

  return (
    <div className={`controls controls-${size}`}>
      <button className="btn-icon" onClick={reset} disabled={!active} title="Reset (R)" aria-label="Reset">
        <IconReset />
      </button>
      {status === 'running' ? (
        <button className="btn-primary btn-round" onClick={pause} title="Pause (Space)" aria-label="Pause">
          <IconPause />
        </button>
      ) : (
        <button className="btn-primary btn-round" onClick={startTimer} title="Start (Space)" aria-label={status === 'paused' ? 'Resume' : 'Start'}>
          <IconPlay />
        </button>
      )}
      {mode === 'pomodoro' && !active ? (
        <button className="btn-icon" onClick={skip} title={phase === 'focus' ? 'Skip to break (S)' : 'Skip break (S)'} aria-label="Skip">
          <IconSkip />
        </button>
      ) : (
        <button
          className="btn-icon"
          onClick={finishSegment}
          disabled={!active}
          title={mode === 'stopwatch' ? 'Finish & log (S)' : 'End early & log (S)'}
          aria-label="Finish"
        >
          <IconStop />
        </button>
      )}
    </div>
  );
}
