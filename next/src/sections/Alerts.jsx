import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_CRITICAL, EVENT_KINDS, formatTime, getAlerts, getEvents, getJson, localDate, updateMe,
} from '../api';

const KIND_OPTIONS = [...new Set(Object.values(EVENT_KINDS).map((k) => k.type))];

// подписи типов событий для панели настроек
const KIND_LABELS = {
  deviceOverspeed: 'Превышение скорости',
  geofenceExit: 'Выезд из геозоны',
  geofenceEnter: 'Въезд в геозону',
  deviceFuelDrop: 'Резкое падение топлива',
  deviceFuelIncrease: 'Заправка',
  deviceOffline: 'Потеря связи',
  deviceUnknown: 'Нет данных от трекера',
  deviceOnline: 'Снова на связи',
  deviceMoving: 'Начало движения',
  deviceStopped: 'Остановка',
  ignitionOn: 'Зажигание включено',
  ignitionOff: 'Зажигание выключено',
  alarm: 'Тревога',
  fuelLow: 'Мало топлива',
  towing: 'Эвакуатор',
};

export default function Alerts({ allVehicles, focusOnMap, user, setUser }) {
  const [events, setEvents] = useState(null);
  const [deviceId, setDeviceId] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState(() => localDate(new Date(Date.now() - 2 * 86400000)));
  const [to, setTo] = useState(() => localDate());
  const [zoneNames, setZoneNames] = useState(null);

  // имена геозон для текста событий «въезд/выезд»
  useEffect(() => {
    getJson('/geofences')
      .then((zones) => setZoneNames(Object.fromEntries(zones.map((z) => [z.id, z.name]))))
      .catch(() => setZoneNames({}));
  }, []);

  useEffect(() => {
    const ids = deviceId ? [Number(deviceId)] : allVehicles.map((v) => v.device.id);
    if (!ids.length) { setEvents([]); return; }
    setEvents(null);
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T23:59:59`);
    Promise.all([
      getEvents(ids, fromDate, toDate).catch(() => []),
      getAlerts(`?from=${fromDate.toISOString()}&to=${toDate.toISOString()}${deviceId ? `&deviceId=${deviceId}` : ''}`).catch(() => []),
    ]).then(([eventList, alertList]) => {
      const ours = alertList.map((a) => ({
        id: `ht-${a.id}`,
        deviceId: a.deviceId,
        type: a.type,
        eventTime: a.createdAt,
        message: a.message,
      }));
      setEvents([...eventList, ...ours]
        .sort((a, b) => new Date(b.eventTime) - new Date(a.eventTime))
        .slice(0, 200));
    });
    // повтор при смене фильтров и когда приехал список машин (прямой заход по URL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVehicles.length > 0, deviceId, from, to]);

  const nameById = Object.fromEntries(allVehicles.map((v) => [v.device.id, v.name]));

  // настройки клиента: какие типы показывать и какие критичны
  const [prefs, setPrefs] = useState(() => user?.prefs?.alerts ?? {});
  const [showSettings, setShowSettings] = useState(false);
  const prefFor = (key) => ({
    show: prefs[key]?.show ?? true,
    critical: prefs[key]?.critical ?? DEFAULT_CRITICAL.has(key),
  });
  const setPref = (key, patch) => {
    const next = { ...prefs, [key]: { ...prefFor(key), ...patch } };
    setPrefs(next);
    updateMe({ prefs: { ...(user?.prefs ?? {}), alerts: next } }).then(setUser).catch(() => {});
  };

  // зональные настройки выхода: critical | normal | hidden (переопределяют тип «Выезд из геозоны»)
  const zoneExitPrefs = user?.prefs?.geofenceExit ?? {};
  const zoneExitMode = (e) => (e.type === 'geofenceExit' ? zoneExitPrefs[e.geofenceId] : undefined);

  const filtered = useMemo(() => {
    if (!events) return null;
    let list = events.filter((e) => (zoneExitMode(e) === 'hidden' ? false : prefFor(e.type).show || zoneExitMode(e) === 'critical'));
    if (kind) list = list.filter((e) => (EVENT_KINDS[e.type]?.type ?? e.type) === kind);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, kind, prefs, user?.prefs]);

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ width: 190 }}>
          <label>Объект</label>
          <select className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Все объекты</option>
            {allVehicles.map((v) => <option key={v.device.id} value={v.device.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 170 }}>
          <label>Событие</label>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Все события</option>
            {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>С</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>По</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: 'auto', ...(showSettings ? { color: 'var(--color-accent)' } : {}) }}
          onClick={() => setShowSettings((s) => !s)}
        >
          ⚙ Настроить
        </button>
      </div>

      {showSettings && (
        <div style={{ border: '1px solid var(--color-divider)', borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <b style={{ fontSize: 14 }}>Настройка уведомлений</b>
            <span className="text-muted" style={{ fontSize: 12 }}>скрытые типы не показываются в ленте, критичные подсвечиваются красным</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
            {Object.keys(KIND_LABELS).map((key) => {
              const p = prefFor(key);
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', opacity: p.show ? 1 : 0.55 }}>
                  <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{KIND_LABELS[key]}</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }} className="text-muted">
                    <input type="checkbox" checked={p.show} onChange={(e) => setPref(key, { show: e.target.checked })} />
                    показывать
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer', color: p.critical ? '#c0392b' : undefined }} className={p.critical ? '' : 'text-muted'}>
                    <input type="checkbox" checked={p.critical} disabled={!p.show} onChange={(e) => setPref(key, { critical: e.target.checked })} />
                    критично
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {filtered === null && <div className="text-muted">Загрузка…</div>}
      {filtered?.length === 0 && <div className="text-muted">Событий за выбранный период нет</div>}
      {filtered?.map((event) => {
        const k = EVENT_KINDS[event.type] ?? { type: event.type, tagClass: 'tag tag-neutral', text: () => '' };
        const zoneMode = zoneExitMode(event);
        const critical = zoneMode ? zoneMode === 'critical' : prefFor(event.type).critical;
        return (
          <div key={event.id} style={{
            display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 10,
            border: critical ? '1px solid #c0392b' : '1px solid var(--color-divider)',
            background: critical ? 'color-mix(in srgb, #c0392b 6%, transparent)' : 'transparent',
          }}>
            {critical && <span title="Критичное" style={{ flex: 'none', color: '#c0392b', fontSize: 15 }}>&#9888;</span>}
            <span className={k.tagClass} style={{ flex: 'none' }}>{k.type}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}><b>{nameById[event.deviceId] ?? `#${event.deviceId}`}</b> — {k.text(event, zoneNames)}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{formatTime(event.eventTime)}</div>
            </div>
            <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => focusOnMap(event.deviceId)}>На карте</button>
          </div>
        );
      })}
    </div>
  );
}
