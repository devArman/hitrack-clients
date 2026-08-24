import { useEffect, useReducer } from 'react';
import { api, formatTime, getJson } from './api';
import { Icon } from './ui';

export const getAnnouncements = () => getJson('/announcements');
export const markAnnouncementRead = (id) => api(`/announcements/${id}/read`, { method: 'POST' });

// ── мини-стор: одно состояние объявлений на всё приложение (модалка, список, колокольчик) ──
let state = null; // null — ещё не загружено
const listeners = new Set();
let started = false;

const emit = () => listeners.forEach((listener) => listener());

async function load() {
  try {
    state = await getAnnouncements();
  } catch {
    state = state ?? [];
  }
  emit();
}

export function useAnnouncements() {
  const [, force] = useReducer((c) => c + 1, 0);

  useEffect(() => {
    listeners.add(force);
    if (!started) {
      started = true;
      load();
      // новые объявления подъезжают без перезахода: частый опрос + обновление при возврате на вкладку
      setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 15000);
      window.addEventListener('focus', load);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
    }
    return () => listeners.delete(force);
  }, []);

  const markRead = async (id) => {
    state = (state ?? []).map((a) => (a.id === id ? { ...a, read: true } : a));
    emit();
    try { await markAnnouncementRead(id); } catch { /* отметим при следующей загрузке */ }
  };

  const announcements = state ?? [];
  return {
    announcements,
    unreadCount: announcements.filter((a) => !a.read).length,
    markRead,
  };
}

/** Колокольчик с числом непрочитанных объявлений. */
export function AnnouncementsBell({ onClick, size = 20 }) {
  const { unreadCount } = useAnnouncements();
  return (
    <button
      className="btn btn-ghost"
      onClick={onClick}
      style={{ position: 'relative', padding: 8, color: 'inherit' }}
      title="Объявления"
    >
      <Icon name="megaphone" size={size} />
      {unreadCount > 0 && (
        <span style={{
          position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16,
          padding: '0 4px', borderRadius: 8, background: 'var(--color-accent)',
          color: 'var(--color-bg)', fontSize: 10, fontWeight: 700,
          display: 'grid', placeItems: 'center', lineHeight: 1,
        }}>
          {unreadCount}
        </span>
      )}
    </button>
  );
}

/** Всплывающее окно с непрочитанными объявлениями — по одному, «Понятно» отмечает прочтение. */
export function AnnouncementsModal() {
  const { announcements, markRead } = useAnnouncements();
  const queue = announcements.filter((a) => !a.read);
  const current = queue[0];
  if (!current) return null;

  return (
    <div className="dialog-backdrop" style={{ zIndex: 2000 }}>
      <div className="dialog">
        <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>
          Объявление · {formatTime(current.createdAt)}
        </div>
        <div className="dialog-title">{current.subject}</div>
        <div className="dialog-body" style={{ whiteSpace: 'pre-wrap' }}>{current.body}</div>
        <div className="dialog-actions">
          {queue.length > 1 && <span className="text-muted" style={{ marginRight: 'auto', fontSize: 12, alignSelf: 'center' }}>ещё {queue.length - 1}</span>}
          <button className="btn btn-primary" onClick={() => markRead(current.id)}>Понятно</button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementItems() {
  const { announcements } = useAnnouncements();
  if (!announcements.length) {
    return <div className="text-muted" style={{ fontSize: 13, padding: 8 }}>Объявлений пока нет</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {announcements.map((a) => (
        <div
          key={a.id}
          style={{
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4,
            border: '1px solid var(--color-divider)', borderRadius: 16,
            background: a.read ? 'transparent' : 'var(--color-surface)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>{a.subject}</b>
            {!a.read && <span className="tag tag-accent">новое</span>}
            <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{formatTime(a.createdAt)}</span>
          </div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{a.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Выпадающая панель объявлений (десктоп) — открывается рупором в шапке. */
export function AnnouncementsPanel({ onClose }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1500 }} onClick={onClose} />
      <div style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 8, width: 380, maxHeight: '70vh',
        overflow: 'auto', zIndex: 1600, background: 'var(--color-bg)',
        border: '1px solid var(--color-divider)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 12,
      }}>
        <h6 style={{ margin: '0 0 8px' }}>Объявления</h6>
        <AnnouncementItems />
      </div>
    </>
  );
}

/** Полноэкранный список объявлений (мобильный). */
export function AnnouncementsScreen({ onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1300, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 12px 12px', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><Icon name="arrow-left" size={18} /></button>
        <b style={{ fontSize: 17, fontFamily: 'var(--font-heading)', letterSpacing: '.02em' }}>Объявления</b>
      </div>
      <AnnouncementItems />
    </div>
  );
}
