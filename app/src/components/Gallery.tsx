import { useEffect, useMemo, useState } from 'react';
import { ART_STYLES } from '../art/engine';
import { deleteArtwork, listArtworks, type Artwork } from '../lib/gallery';
import { fmtDuration } from '../lib/time';
import { useStore } from '../store';
import { IconClose, IconDownload, IconTrash } from './icons';

export function Gallery() {
  const activities = useStore((s) => s.activities);
  const artCount = useStore((s) => s.sessions.reduce((n, x) => n + (x.hasArt ? 1 : 0), 0));
  const [items, setItems] = useState<Artwork[] | null>(null);
  const [open, setOpen] = useState<Artwork | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    void listArtworks().then(setItems);
  }, [artCount]);

  const urls = useMemo(() => new Map((items ?? []).map((a) => [a.id, URL.createObjectURL(a.blob)])), [items]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const shown = (items ?? []).filter((a) => filter === 'all' || a.style === filter);
  const act = (id?: string) => activities.find((a) => a.id === id);

  const remove = async (a: Artwork) => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    await deleteArtwork(a.id);
    setOpen(null);
    setItems(await listArtworks());
  };

  return (
    <section className="page">
      <div className="page-head">
        <h1>Gallery</h1>
        <select className="input input-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by style">
          <option value="all">All styles</option>
          {ART_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {items && !items.length && (
        <p className="empty">
          Every focus session paints a unique piece. Finish one and it will be hung here.
        </p>
      )}
      <div className="gallery">
        {shown.map((a) => (
          <button key={a.id} className="art-card" onClick={() => setOpen(a)}>
            <img src={urls.get(a.id)} alt={a.title} loading="lazy" />
            <span className="art-caption">
              <strong>{a.title}</strong>
              <span>
                {act(a.activityId)?.emoji} {fmtDuration(a.durationMs)} · {new Date(a.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </span>
          </button>
        ))}
      </div>

      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label={open.title}>
          <img src={urls.get(open.id)} alt={open.title} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar glass" onClick={(e) => e.stopPropagation()}>
            <div>
              <strong>{open.title}</strong>
              <div className="muted small">
                {ART_STYLES.find((s) => s.id === open.style)?.name} · {act(open.activityId)?.name} · {fmtDuration(open.durationMs)} ·{' '}
                {new Date(open.createdAt).toLocaleString()}
                {open.intent && ` · “${open.intent}”`}
              </div>
            </div>
            <div className="row">
              <a className="btn-icon" href={urls.get(open.id)} download={`${open.title.replace(/\s+/g, '-').toLowerCase()}.jpg`} aria-label="Download">
                <IconDownload />
              </a>
              <button className="btn-icon danger" onClick={() => void remove(open)} aria-label="Delete">
                <IconTrash />
              </button>
              <button className="btn-icon" onClick={() => setOpen(null)} aria-label="Close">
                <IconClose />
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
