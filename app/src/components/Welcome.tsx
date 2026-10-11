import { APP_NAME } from '../brand';
import { isDesktop } from '../lib/desktop';
import { useStore } from '../store';

/** First launch only: what the app does, in four lines. */
export function Welcome() {
  const welcomed = useStore((s) => s.settings.welcomed);
  const update = useStore((s) => s.updateSettings);
  if (welcomed) return null;
  const done = () => update({ welcomed: true });
  return (
    <div className="welcome-scrim">
      <div className="welcome glass" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={44} height={44} />
        <h2 id="welcome-title">Welcome to {APP_NAME}</h2>
        <ul>
          <li>
            <strong>Pick what you're working on and press Start</strong> (or <kbd>Space</kbd>).
          </li>
          <li>
            <strong>A new artwork paints itself while you focus.</strong> Finished pieces go to your Gallery.
          </li>
          {isDesktop && (
            <li>
              <strong>Switch to another window and a small timer floats on top</strong>, so you can keep an eye on it.
            </li>
          )}
          <li>
            <strong>Everything stays on this device.</strong> No account, no tracking.
          </li>
        </ul>
        <button className="btn-primary" onClick={done} autoFocus>
          Get started
        </button>
      </div>
    </div>
  );
}
