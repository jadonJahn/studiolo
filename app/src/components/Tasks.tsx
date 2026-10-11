import { useState } from 'react';
import { MIN } from '../lib/time';
import { useStore } from '../store';
import { IconPlay, IconPlus, IconTrash } from './icons';

export function Tasks({ onStart }: { onStart(): void }) {
  const tasks = useStore((s) => s.tasks);
  const activities = useStore((s) => s.activities);
  const focusMin = useStore((s) => s.settings.focusMin);
  const currentTask = useStore((s) => s.timer.taskId);
  const defaultActivity = useStore((s) => s.timer.activityId);
  const { addTask, toggleTask, removeTask, updateTask, setTask, clearDoneTasks } = useStore.getState();

  const [title, setTitle] = useState('');
  const [activityId, setActivityId] = useState(defaultActivity);
  const [estimate, setEstimate] = useState(1);
  const [showDone, setShowDone] = useState(false);

  const open = tasks.filter((k) => !k.done);
  const done = tasks.filter((k) => k.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const act = (id?: string) => activities.find((a) => a.id === id);

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!title.trim()) return;
    addTask(title.trim(), activityId, estimate);
    setTitle('');
    setEstimate(1);
  };

  return (
    <section className="page">
      <h1>Tasks</h1>
      <form className="task-form glass" onSubmit={submit}>
        <input className="input grow" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)} aria-label="Activity">
          {activities
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
        </select>
        <label className="est" title="Estimated focus blocks">
          <input className="input" type="number" min={1} max={20} value={estimate} onChange={(e) => setEstimate(Math.max(1, Math.min(20, +e.target.value || 1)))} />
          <span className="muted">blocks</span>
        </label>
        <button className="btn-primary" type="submit">
          <IconPlus /> Add
        </button>
      </form>

      {open.length === 0 && <p className="empty">No open tasks. Add one above, then start a focus block on it.</p>}

      <ul className="task-list">
        {open.map((k) => {
          const a = act(k.activityId);
          const blocks = k.spentMs / (focusMin * MIN);
          return (
            <li key={k.id} className={`task glass ${currentTask === k.id ? 'is-current' : ''}`}>
              <input type="checkbox" checked={false} onChange={() => toggleTask(k.id)} aria-label={`Complete ${k.title}`} />
              <span className="task-dot" style={{ background: a?.color }} title={a?.name} />
              <input className="task-title" value={k.title} onChange={(e) => updateTask(k.id, { title: e.target.value })} aria-label="Task title" />
              <span className="task-progress" title={`${Math.round(k.spentMs / MIN)} min spent`}>
                {Array.from({ length: Math.max(k.estimate, Math.ceil(blocks)) }, (_, i) => (
                  <i key={i} className={i < Math.floor(blocks) ? 'on' : i < blocks ? 'half' : ''} />
                ))}
              </span>
              <button
                className="btn-icon btn-sm"
                title="Focus on this"
                aria-label={`Focus on ${k.title}`}
                onClick={() => {
                  setTask(k.id);
                  onStart();
                }}
              >
                <IconPlay />
              </button>
              <button className="btn-icon btn-sm danger" onClick={() => removeTask(k.id)} aria-label={`Delete ${k.title}`}>
                <IconTrash />
              </button>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <div className="done-section">
          <button className="btn-ghost" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
          {showDone && (
            <>
              <ul className="task-list">
                {done.map((k) => (
                  <li key={k.id} className="task glass is-done">
                    <input type="checkbox" checked onChange={() => toggleTask(k.id)} aria-label={`Reopen ${k.title}`} />
                    <span className="task-dot" style={{ background: act(k.activityId)?.color }} />
                    <span className="task-title">{k.title}</span>
                    <span className="muted small">{Math.round(k.spentMs / MIN)} min</span>
                    <button className="btn-icon btn-sm danger" onClick={() => removeTask(k.id)} aria-label={`Delete ${k.title}`}>
                      <IconTrash />
                    </button>
                  </li>
                ))}
              </ul>
              <button className="btn-ghost danger" onClick={clearDoneTasks}>
                Clear completed
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
