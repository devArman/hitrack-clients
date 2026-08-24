import { useState } from 'react';
import { logout as apiLogout, updateMe } from '../api';
import { Blueprint, Icon } from '../ui';

export default function MobileProfile({ user, setUser, vehicles, theme, setTheme }) {
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [status, setStatus] = useState(null);

  const save = async () => {
    setStatus('saving');
    try {
      setUser(await updateMe({ name, phone }));
      setStatus('saved');
      setTimeout(() => setStatus(null), 2000);
    } catch (error) {
      setStatus(`Ошибка: ${error.message}`);
    }
  };

  const logout = async () => {
    await apiLogout();
    window.location.reload();
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '6px 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 46, height: 46, display: 'grid', placeItems: 'center', borderRadius: 12, background: 'var(--grad-brand)', color: '#fff', fontFamily: 'var(--font-heading)', fontSize: 19 }}>
          {(user.name || user.email).split(/[\s@]+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')}
        </span>
        <div>
          <b style={{ fontSize: 16 }}>{user.name || user.email}</b>
          <div className="text-muted" style={{ fontSize: 12 }}>{user.email}</div>
        </div>
      </div>
      <Blueprint style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h5 style={{ margin: 0 }}>Профиль</h5>
        <div className="field"><label>Имя</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Телефон</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={status === 'saving'}>
            {status === 'saving' ? 'Сохранение…' : 'Сохранить'}
          </button>
          {status === 'saved' && <span style={{ fontSize: 13, color: 'var(--color-accent)' }}>Сохранено</span>}
          {status?.startsWith?.('Ошибка') && <span style={{ fontSize: 12, color: '#c0392b' }}>{status}</span>}
        </div>
      </Blueprint>
      <Blueprint style={{ padding: 14 }}>
        <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Тариф</div>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>3 000 ֏ / трекер / мес</div>
        <div className="text-muted" style={{ fontSize: 12 }}>Трекеров: {vehicles.length} · оборудование и поддержка включены</div>
      </Blueprint>
      <button className="btn btn-secondary btn-block" style={{ marginTop: 0 }} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
        <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
        {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
      </button>
      <button className="btn btn-secondary btn-block" style={{ marginTop: 0 }} onClick={logout}>
        <Icon name="log-out" size={15} />
        Выйти
      </button>
    </div>
  );
}
