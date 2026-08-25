import { useEffect, useMemo, useState } from 'react';
import { getDeviceStats, ST, vehicleState } from '../api';
import { Icon } from '../ui';
import { AnnouncementsBell, AnnouncementsModal, AnnouncementsScreen } from '../Announcements';
import MobileMap from './MobileMap';
import MobileObjects from './MobileObjects';
import MobileDetail from './MobileDetail';
import MobileEvents from './MobileEvents';
import MobileProfile from './MobileProfile';

const TABS = [
  ['map', 'Карта', 'map'],
  ['objects', 'Объекты', 'truck'],
  ['events', 'События', 'bell'],
  ['profile', 'Профиль', 'user'],
];

const AVATAR = {
  width: 36, height: 36, flex: 'none', display: 'grid', placeItems: 'center',
  borderRadius: '50%', boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
};


// раздел живёт в URL (#/map, #/fleet…): F5 возвращает туда же, работает «назад»
function useHashSection(valid, fallback) {
  const read = () => {
    const h = window.location.hash.replace(/^#\/?/, '');
    return valid.includes(h) ? h : fallback;
  };
  const [section, setSection] = useState(read);
  useEffect(() => {
    const onHash = () => setSection(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (window.location.hash.replace(/^#\/?/, '') !== section) {
      window.history.replaceState(null, '', `#/${section}`);
    }
  }, [section]);
  return [section, setSection];
}

export default function MobileShell({ user, setUser, devices, positions }) {
  const [tab, setTab] = useHashSection(TABS.map(([id]) => id), 'map');
  const [detailId, setDetailId] = useState(null); // открытая карточка объекта
  const [trackFor, setTrackFor] = useState(null); // «построить трек» на карте
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'light');

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);

  const vehicles = useMemo(() => {
    const list = Object.values(devices).map((device) => {
      const position = positions[device.id];
      const { st, speed } = vehicleState(device, position);
      return {
        device, position, st, speed,
        name: device.name,
        plate: device.attributes?.plate ?? device.attributes?.registration ?? device.uniqueId,
        stLabel: ST[st].label, dotColor: ST[st].dot,
        stLine: st === 'move' ? `Движется · ${speed} км/ч` : ST[st].label,
      };
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [devices, positions]);

  // суточная статистика по всем машинам — одним запросом на всё приложение
  const [stats, setStats] = useState({}); // deviceId -> {distanceMeters, maxSpeedKnots, overspeedCount}
  useEffect(() => {
    const load = () => getDeviceStats()
      .then((rows) => setStats(Object.fromEntries(rows.map((r) => [r.deviceId, r]))))
      .catch(() => {});
    load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 180000);
    return () => clearInterval(timer);
  }, []);

  const [showAnnouncements, setShowAnnouncements] = useState(false);
  // на вкладке карты шапка прячется, а её кнопки уезжают поверх карты —
  // экран маленький, заголовок «Карта» и так дублирует подсвеченную вкладку внизу
  const [mapCovers, setMapCovers] = useState(true);

  // «АШ» — первые буквы имени и фамилии (или e-mail, если имени нет)
  const initials = (user.name || user.email)
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toUpperCase()).join('');

  const openDetail = (id) => { setDetailId(id); };
  const buildTrack = (id) => { setTrackFor(id); setDetailId(null); setTab('map'); };

  const openProfile = () => { setTab('profile'); setDetailId(null); };
  const common = {
    user, setUser, vehicles, devices, positions, stats, openDetail, theme, setTheme,
    openAnnouncements: () => setShowAnnouncements(true), openProfile, initials,
  };
  const headerHidden = tab === 'map' && mapCovers;

  return (
    <div data-theme={theme} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'var(--font-body)', overflow: 'hidden' }}>
      <AnnouncementsModal />
      {/* общая шапка: раздел, объявления и аватар. На карте её нет — кнопки лежат поверх карты */}
      {!headerHidden && <div style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 8,
        padding: 'calc(8px + env(safe-area-inset-top)) 12px 4px',
      }}>
        {/* на карте заголовок не нужен: вкладка и так подсвечена внизу, а место дорого */}
        <b style={{ fontFamily: 'var(--font-heading)', fontSize: 19, letterSpacing: '.02em' }}>
          {tab === 'map' ? '' : TABS.find(([id]) => id === tab)?.[1]}
        </b>
        <span style={{
          ...AVATAR, marginLeft: 'auto',
          background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
          border: '1px solid var(--color-divider)',
        }}>
          <AnnouncementsBell onClick={() => setShowAnnouncements(true)} size={17} />
        </span>
        <span
          onClick={() => { setTab('profile'); setDetailId(null); }}
          title={user.name || user.email}
          style={{ ...AVATAR, background: 'var(--grad-brand)', color: '#fff', fontFamily: 'var(--font-heading)', fontSize: 13 }}
        >
          {initials}
        </span>
      </div>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {tab === 'map' && <MobileMap {...common} trackFor={trackFor} clearTrack={() => setTrackFor(null)} onMapCovers={setMapCovers} />}
        {tab === 'objects' && <MobileObjects {...common} />}
        {tab === 'events' && <MobileEvents {...common} />}
        {tab === 'profile' && <MobileProfile {...common} />}
        {showAnnouncements && <AnnouncementsScreen onClose={() => setShowAnnouncements(false)} />}
        {detailId != null && (
          <MobileDetail
            {...common}
            vehicle={vehicles.find((v) => v.device.id === detailId)}
            onClose={() => setDetailId(null)}
            onBuildTrack={() => buildTrack(detailId)}
          />
        )}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-around', flex: 'none',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
        background: 'var(--color-surface)', borderTop: '1px solid var(--color-divider)',
      }}>
        {TABS.map(([id, label, icon]) => (
          <div
            key={id}
            onClick={() => { setTab(id); setDetailId(null); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              fontSize: 10, minWidth: 44, cursor: 'pointer',
              color: tab === id ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-text) 45%, transparent)',
            }}
          >
            <Icon name={icon} size={20} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
