import { useEffect, useState } from 'react';
import { saveWidgetPos, type WidgetCommand, type WidgetSync } from '../lib/widget';
import { useStore } from '../store';
import { Widget } from './Widget';

/** Root of the desktop shell's floating widget window; a mirror of the main window. */
export function WidgetWindow() {
  const [shown, setShown] = useState(false);
  const layout = useStore((s) => s.settings.widget);

  useEffect(() => {
    document.documentElement.classList.add('is-widget');
    let live = true;
    const unlisten: (() => void)[] = [];
    void (async () => {
      const { emitTo, listen } = await import('@tauri-apps/api/event');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const fns = [
        await listen<WidgetSync>('widget-sync', ({ payload: { shown: on, ...state } }) => {
          useStore.setState(state);
          setShown(on);
        }),
        await getCurrentWindow().onMoved(({ payload: p }) => {
          clearTimeout(moveTimer);
          moveTimer = setTimeout(() => {
            const l = useStore.getState().settings.widget;
            if (l !== 'off') saveWidgetPos(l, p.x, p.y);
          }, 300);
        }),
      ];
      if (!live) return fns.forEach((f) => f());
      unlisten.push(...fns);
      await emitTo('main', 'widget-ready');
    })();
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    return () => {
      live = false;
      unlisten.forEach((f) => f());
    };
  }, []);

  // Render nothing while hidden so the art doesn't keep painting off-screen.
  if (!shown || layout === 'off') return null;
  return (
    <Widget
      layout={layout}
      onCommand={(cmd: WidgetCommand) => void import('@tauri-apps/api/event').then(({ emitTo }) => emitTo('main', 'widget-cmd', cmd))}
      onDragStart={() => void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().startDragging())}
    />
  );
}
