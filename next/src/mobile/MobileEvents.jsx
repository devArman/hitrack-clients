import { useEffect, useMemo, useState } from 'react';
import { alertPrefs, eventKind, getAlerts, getEvents, getJson } from '../api';
import { Icon } from '../ui';

const PERIODS = [['1', 'Сутки'], ['3', '3 дня'], ['7', '7 дней']];

const DAY = 86400000;
const LIMIT = 500; // потолок ленты; если упёрлись — говорим об этом под списком

// «Сегодня» / «Вчера» / «22 августа»
function dayLabel(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const diff = Math.round((today - start) / DAY);
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const hhmm = (value) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export default function MobileEvents({ vehicles, user, openDetail }) {
  const [events, setEvents] = useState(null);
  const [zoneNames, setZoneNames] = useState(null);
  // сутки по умолчанию: бэкенд не умеет фильтровать события по типу,
  // поэтому период напрямую упирается в размер ответа (см. заметку в README задачи)
  const [days, setDays] = useState('1');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');

  // имена геозон для текста событий «въезд/выезд»
  useEffect(() => {
    getJson('/geofences')
      .then((zones) => setZoneNames(Object.fromEntries(zones.map((z) => [z.id, z.name]))))
      .catch(() => setZoneNames({}));
  }, []);

  useEffect(() => {
    const ids = vehicles.map((v) => v.device.id);
    if (!ids.length) { setEvents([]); return; }
    setEvents(null);
    const from = new Date(Date.now() - Number(days) * DAY);
    const to = new Date();
    Promise.all([
      getEvents(ids, from, to).catch(() => []),
      // наши собственные алерты (мало топлива, эвакуатор) живут отдельно от Traccar
      getAlerts(`?from=${from.toISOString()}&to=${to.toISOString()}`).catch(() => []),
    ]).then(([eventList, alertList]) => {
      const ours = alertList.map((a) => ({
        id: `ht-${a.id}`, deviceId: a.deviceId, type: a.type, eventTime: a.createdAt, message: a.message,
      }));
      setEvents([...eventList, ...ours]
        .sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime))
        .slice(0, LIMIT));
    });
    // повтор при смене периода и когда приехал список машин
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles.length > 0, days]);

  const nameById = useMemo(
    () => Object.fromEntries(vehicles.map((v) => [v.device.id, v.name])),
    [vehicles],
  );
  const prefs = useMemo(() => alertPrefs(user), [user]);

  // сначала настройки клиента и поиск по объекту — от них считаются счётчики чипов
  const visible = useMemo(() => {
    if (!events) return null;
    const q = search.trim().toLowerCase();
    return events.filter((e) => prefs.show(e)
      && (!q || String(nameById[e.deviceId] ?? e.deviceId).toLowerCase().includes(q)));
  }, [events, prefs, search, nameById]);

  const counts = useMemo(() => {
    const map = {};
    visible?.forEach((e) => { const k = eventKind(e.type).type; map[k] = (map[k] ?? 0) + 1; });
    return map;
  }, [visible]);

  const filtered = useMemo(
    () => (kind ? visible?.filter((e) => eventKind(e.type).type === kind) : visible),
    [visible, kind],
  );

  // группировка по дням: [['Сегодня', [события…]], …]
  const groups = useMemo(() => {
    if (!filtered) return null;
    const out = [];
    filtered.forEach((e) => {
      const label = dayLabel(e.eventTime);
      if (out[out.length - 1]?.[0] !== label) out.push([label, []]);
      out[out.length - 1][1].push(e);
    });
    return out;
  }, [filtered]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '4px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.45 }} />
          <input
            className="input"
            placeholder="Объект…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ borderRadius: 999, minHeight: 38, paddingLeft: 32, fontSize: 14 }}
          />
        </div>
        <div className="chip-row">
          {PERIODS.map(([value, label]) => (
            <span key={value} className={`chip${days === value ? ' chip-active' : ''}`} onClick={() => setDays(value)}>
              {label}
            </span>
          ))}
        </div>
        <div className="chip-row">
          <span className={`chip${kind === '' ? ' chip-active' : ''}`} onClick={() => setKind('')}>
            Все <span className="count">{visible?.length ?? 0}</span>
          </span>
          {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <span key={k} className={`chip${kind === k ? ' chip-active' : ''}`} onClick={() => setKind(kind === k ? '' : k)}>
              {k} <span className="count">{n}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 10px' }}>
        {groups === null && <div className="text-muted" style={{ padding: 12, fontSize: 13 }}>Загрузка…</div>}
        {groups?.length === 0 && (
          <div className="text-muted" style={{ padding: 12, fontSize: 13 }}>
            {events?.length ? 'Ничего не найдено по фильтрам' : 'За выбранный период событий нет'}
          </div>
        )}
        {groups?.map(([label, list]) => (
          <div key={label}>
            <div style={{
              position: 'sticky', top: 0, zIndex: 1, padding: '8px 2px 4px',
              background: 'var(--color-bg)', fontSize: 11, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--color-accent)',
            }}>
              {label} <span className="text-muted">· {list.length}</span>
            </div>
            {list.map((event) => {
              const k = eventKind(event.type);
              const critical = prefs.critical(event);
              return (
                <div
                  key={event.id}
                  onClick={() => openDetail(event.deviceId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', minHeight: 44,
                    borderBottom: '1px solid var(--color-divider)', cursor: 'pointer',
                    ...(critical ? { background: 'color-mix(in srgb, #c0392b 7%, transparent)' } : {}),
                  }}
                >
                  {critical && <Icon name="triangle-alert" size={13} style={{ flex: 'none', color: '#c0392b' }} />}
                  <span className={k.tagClass} style={{ flex: 'none' }}>{k.type}</span>
                  <div style={{ minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <b>{nameById[event.deviceId] ?? `#${event.deviceId}`}</b>
                    <span className="text-muted"> — {k.text(event, zoneNames)}</span>
                  </div>
                  <span className="text-muted" style={{ marginLeft: 'auto', flex: 'none', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                    {hhmm(event.eventTime)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {events?.length === LIMIT && (
          <div className="text-muted" style={{ padding: '10px 4px', fontSize: 12 }}>
            Показаны последние {LIMIT} событий — сузьте период или выберите тип.
          </div>
        )}
      </div>
    </div>
  );
}
