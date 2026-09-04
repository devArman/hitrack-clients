import { useEffect, useMemo, useRef, useState } from 'react';
import LeafletMap from '../LeafletMap';
import {
  deviceEmoji, fuelLevel, fuelLiters, getDeviceGroups,
  getDeviceStats, getDeviceTimeline, getJson, getRoute, hm, kmLabel, KNOTS_TO_KMH,
  lastDays, localDate, sendCommand, telemetryFacts, timeAgo, timelineSummary,
} from '../api';
import GroupDialog from './GroupDialog';
import { ConfirmDialog, Icon, StatusDot } from '../ui';

// фильтр по связи: значение → подпись
const CONN = [
  ['all', 'Все'],
  ['online', 'Online'],
  ['off', 'Offline'],
];

const tripTime = (value) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export default function MapView({ vehicles, devices, positions, focus, mapGroupPreset }) {
  const [localFocus, setLocalFocus] = useState(focus);
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState('all');
  const [conn, setConn] = useState('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [stats, setStats] = useState({}); // deviceId -> {distanceMeters, maxSpeedKnots, overspeedCount}

  // лента дня (поездки и стоянки) и маршрут — прямо на этой карте
  const [timeline, setTimeline] = useState(null); // { rows, loading, error }
  const [track, setTrack] = useState(null);
  const [activeTrip, setActiveTrip] = useState(null);

  const clearTrips = () => { setTimeline(null); setTrack(null); setActiveTrip(null); };
  // защита от гонок: ответ устаревшего запроса ленты (другая машина/день) игнорируем
  const timelineReq = useRef(0);
  const retryTimer = useRef(null);
  useEffect(() => () => clearTimeout(retryTimer.current), []);


  const [groupDialog, setGroupDialog] = useState(null); // { group: null|{} }

  const reloadGroups = () => getDeviceGroups().then(setGroups).catch(() => {});
  useEffect(() => { reloadGroups(); }, []);

  // пришли из раздела «Группы» — сразу включаем этот фильтр
  useEffect(() => {
    if (mapGroupPreset?.groupId != null) setGroupId(mapGroupPreset.groupId);
  }, [mapGroupPreset]);

  // суточная статистика: при открытии и раз в 3 минуты
  useEffect(() => {
    const load = () => getDeviceStats()
      .then((rows) => setStats(Object.fromEntries(rows.map((r) => [r.deviceId, r]))))
      .catch(() => {});
    load();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 180000);
    return () => clearInterval(timer);
  }, []);

  const currentFocus = localFocus.seq >= focus.seq ? localFocus : focus;

  // сначала группа — от неё считаются счётчики в чипах связи
  const groupSet = useMemo(() => {
    const g = groups.find((x) => x.id === groupId);
    return g ? new Set(g.deviceIds) : null;
  }, [groups, groupId]);

  const inGroup = useMemo(() => {
    const query = q.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (groupSet && !groupSet.has(v.device.id)) return false;
      if (!query) return true;
      return v.name.toLowerCase().includes(query);
    });
  }, [vehicles, groupSet, q]);

  const counts = useMemo(() => ({
    all: inGroup.length,
    online: inGroup.filter((v) => v.st !== 'off').length,
    off: inGroup.filter((v) => v.st === 'off').length,
  }), [inGroup]);

  const filtered = useMemo(() => inGroup.filter((v) => {
    if (conn === 'online') return v.st !== 'off';
    if (conn === 'off') return v.st === 'off';
    return true;
  }), [inGroup, conn]);

  // фильтр действует и на маркеры карты; при показе маршрута на карте
  // остаётся только выбранная машина
  const [mapDevices, mapPositions] = useMemo(() => {
    const ids = track && selectedId != null
      ? new Set([selectedId])
      : new Set(filtered.map((v) => v.device.id));
    return [
      Object.fromEntries(Object.entries(devices).filter(([id]) => ids.has(Number(id)))),
      Object.fromEntries(Object.entries(positions).filter(([id]) => ids.has(Number(id)))),
    ];
  }, [filtered, devices, positions, track, selectedId]);

  const selected = selectedId != null ? vehicles.find((v) => v.device.id === selectedId) : null;

  const pick = (v) => {
    if (v.device.id !== selectedId) clearTrips();
    setSelectedId(v.device.id);
    setLocalFocus((f) => ({ id: v.device.id, seq: Math.max(f.seq, focus.seq) + 1 }));
  };

  const loadTimeline = async (deviceId, range) => {
    const req = ++timelineReq.current;
    clearTimeout(retryTimer.current);
    setTrack(null);
    setActiveTrip(null);
    setTimeline({ rows: [], loading: true });
    try {
      // сегменты короче 100 м бэкенд уже приклеил к стоянке
      const rows = await getDeviceTimeline(deviceId, range.from, range.to);
      if (req !== timelineReq.current) return;
      setTimeline({ rows, loading: false });
      scheduleAddressRefetch(deviceId, range, rows, req, 0);
    } catch (error) {
      if (req === timelineReq.current) setTimeline({ rows: [], loading: false, error: error.message });
    }
  };

  // адреса стоянок бэкенд геокодит фоном (~1 адрес/с, лимит Nominatim) —
  // тихо перезапрашиваем ленту, пока не доедут все или не кончатся попытки
  const scheduleAddressRefetch = (deviceId, range, rows, req, attempt) => {
    const missing = rows.filter((s) => s.type === 'park' && !s.address).length;
    if (!missing || attempt >= 4) return;
    const delay = Math.min(2500 + missing * 1200, 15000);
    retryTimer.current = setTimeout(async () => {
      if (req !== timelineReq.current) return;
      try {
        const fresh = await getDeviceTimeline(deviceId, range.from, range.to);
        if (req !== timelineReq.current) return;
        setTimeline({ rows: fresh, loading: false });
        scheduleAddressRefetch(deviceId, range, fresh, req, attempt + 1);
      } catch { /* фоновый дозапрос — ошибки не показываем */ }
    }, delay);
  };

  const showTripTrack = async (trip, index) => {
    if (activeTrip === index) { setTrack(null); setActiveTrip(null); return; }
    setActiveTrip(index);
    try {
      setTrack(await getRoute(selectedId, new Date(trip.startTime), new Date(trip.endTime)));
    } catch {
      setTrack(null);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ width: 420, flex: 'none', borderRight: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* поиск + фильтры */}
        <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.45 }} />
            <input
              className="input"
              placeholder="Поиск по названию…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ borderRadius: 999, minHeight: 34, paddingLeft: 32, fontSize: 13 }}
            />
          </div>
          <div className="chip-row">
            {CONN.map(([id, label]) => (
              <span key={id} className={`chip${conn === id ? ' chip-active' : ''}`} onClick={() => setConn(id)}>
                {label} <span className="count">{counts[id]}</span>
              </span>
            ))}
          </div>
          <div className="chip-row">
            {groups.length > 0 && (
              <span className={`chip${groupId === 'all' ? ' chip-active' : ''}`} onClick={() => setGroupId('all')}>
                Все группы
              </span>
            )}
            {groups.map((g) => (
              <span key={g.id} className={`chip${groupId === g.id ? ' chip-active' : ''}`} onClick={() => setGroupId(groupId === g.id ? 'all' : g.id)}>
                {g.name} <span className="count">{g.deviceIds.length}</span>
                {g.own && (
                  <span
                    style={{ display: 'inline-flex', opacity: 0.7, padding: '2px 0 2px 2px' }}
                    title="Изменить группу"
                    onClick={(e) => { e.stopPropagation(); setGroupDialog({ group: g }); }}
                  >
                    <Icon name="pencil" size={11} />
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
        {/* список */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((v) => {
            const fuel = fuelLevel(v.position);
            const liters = fuelLiters(v.position);
            const updated = timeAgo(v.position?.deviceTime ?? v.device.lastUpdate);
            const address = v.position?.address;
            const stat = stats[v.device.id];
            const maxKmh = stat && Math.round(stat.maxSpeedKnots * KNOTS_TO_KMH);
            return (
              <div
                key={v.device.id}
                className={`veh-card${selectedId === v.device.id ? ' veh-card-active' : ''}`}
                onClick={() => pick(v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusDot color={v.dotColor} />
                  <b style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {deviceEmoji(v.device) ? `${deviceEmoji(v.device)} ` : ''}{v.name}
                  </b>
                  <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12, flex: 'none' }}>{v.plate}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span className={v.tagClass}>{v.stLabel}</span>
                  {v.st === 'move' && <span style={{ fontWeight: 600 }}>{v.speedLabel}</span>}
                  {updated && (
                    <span className="text-muted" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                      <Icon name="clock" size={11} />{updated}
                    </span>
                  )}
                </div>
                {stat && (
                  <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Пробег сегодня">
                      <Icon name="route" size={12} />{kmLabel(stat.distanceMeters)} км
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Макс. скорость сегодня">
                      <Icon name="gauge" size={12} />макс {maxKmh} км/ч
                    </span>
                    {stat.overspeedCount > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#c0392b', marginLeft: 'auto' }} title="Превышений лимита скорости сегодня">
                        <Icon name="triangle-alert" size={12} />{stat.overspeedCount}
                      </span>
                    )}
                  </div>
                )}
                {fuel != null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <Icon name="fuel" size={12} style={{ color: 'var(--color-accent)' }} />
                    <div style={{ flex: 1, height: 5, borderRadius: 999, overflow: 'hidden', background: 'var(--color-neutral-200)' }}>
                      <div style={{ height: '100%', borderRadius: 999, background: 'var(--color-accent)', width: `${Math.min(fuel, 100)}%` }} />
                    </div>
                    <span className="text-muted" style={{ flex: 'none' }}>{fuel}%{liters != null && ` · ${liters} л`}</span>
                  </div>
                )}
                {address && (
                  <div className="text-muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Icon name="map-pin" size={11} style={{ flex: 'none' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{address}</span>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-muted" style={{ fontSize: 13, padding: 8 }}>Нет объектов по выбранным фильтрам</div>}
        </div>
      </div>
      {/* карта + нижняя панель деталей */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0 }}>
        <LeafletMap
          devices={mapDevices}
          positions={mapPositions}
          track={track}
          focusId={currentFocus.id}
          focusSeq={currentFocus.seq}
          onMarkerClick={(id) => {
            if (id !== selectedId) clearTrips();
            setSelectedId(id);
          }}
        />
        {selected && (
          <DetailPanel
            v={selected}
            stat={stats[selected.device.id]}
            onClose={() => { setSelectedId(null); clearTrips(); }}
            timeline={timeline}
            activeTrip={activeTrip}
            onLoadTimeline={loadTimeline}
            onPickTrip={showTripTrack}
          />
        )}
        {groupDialog && (
          <GroupDialog
            group={groupDialog.group}
            vehicles={vehicles}
            onClose={() => setGroupDialog(null)}
            onSaved={() => { setGroupDialog(null); reloadGroups(); }}
            onDeleted={(id) => {
              setGroupDialog(null);
              if (groupId === id) setGroupId('all');
              reloadGroups();
            }}
          />
        )}
      </div>
    </div>
  );
}

// нижняя панель: подробности выбранного объекта поверх карты
function DetailPanel({ v, stat, onClose, timeline, activeTrip, onLoadTimeline, onPickTrip }) {
  const p = v.position;
  const a = p?.attributes ?? {};

  // выбранный день (как в Wialon — лента одного дня)
  const [day, setDay] = useState(() => localDate());
  // сегодняшний день в конце ленты — прокручиваем к нему при открытии
  const daysRef = useRef(null);
  useEffect(() => {
    if (daysRef.current) daysRef.current.scrollLeft = daysRef.current.scrollWidth;
  }, [v.device.id]);
  const [fetched, setFetched] = useState(null);
  const [loadingStat, setLoadingStat] = useState(false);

  const range = useMemo(() => ({
    from: new Date(`${day}T00:00:00`),
    to: new Date(`${day}T23:59:59.999`),
  }), [day]);

  // лента дня грузится сама: при выборе машины и при смене дня
  useEffect(() => {
    onLoadTimeline(v.device.id, range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.device.id, day]);

  useEffect(() => {
    let alive = true;
    setLoadingStat(true);
    getDeviceStats({ deviceId: v.device.id, from: range.from, to: range.to })
      .then((rows) => {
        if (alive) setFetched(rows[0] ?? { distanceMeters: 0, maxSpeedKnots: 0, overspeedCount: 0 });
      })
      .catch(() => { if (alive) setFetched(null); })
      .finally(() => { if (alive) setLoadingStat(false); });
    return () => { alive = false; };
  }, [v.device.id, range]);

  const shownStat = fetched;

  // сводка дня: сколько в движении и сколько на стоянке
  const summary = useMemo(
    () => (timeline && !timeline.loading ? timelineSummary(timeline.rows) : null),
    [timeline],
  );

  // блокировка двигателя — та же логика, что в разделе «Двигатель»
  const blocked = Boolean(a.blocked);
  const [enginePending, setEnginePending] = useState(null); // { block }
  const [engineBusy, setEngineBusy] = useState(false);

  const askEngine = () => {
    // модал подтверждения — сразу и обязательно; поддержку команды
    // проверяем параллельно и снимаем модал, только если её точно нет
    setEnginePending({ block: !blocked });
    getJson(`/commands/types?deviceId=${v.device.id}&textChannel=false`)
      .then((types) => {
        if (!types.some((t) => t.type === 'engineStop')) {
          setEnginePending(null);
          alert('Этот трекер не поддерживает удалённую блокировку двигателя');
        }
      })
      .catch(() => { /* проверить не смогли — модал остаётся, команду проверит бэкенд */ });
  };

  const runEngine = async () => {
    const { block } = enginePending;
    setEnginePending(null);
    setEngineBusy(true);
    try {
      await sendCommand(v.device.id, block ? 'engineStop' : 'engineResume');
      alert(block
        ? 'Команда блокировки отправлена. Двигатель заглохнет после остановки автомобиля.'
        : 'Команда разблокировки отправлена.');
    } catch (error) {
      alert(`Не удалось отправить команду: ${error.message}`);
    } finally {
      setEngineBusy(false);
    }
  };

  const facts = telemetryFacts(v.device, p);

  return (
    <div
      style={{
        position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 1100,
        background: 'var(--color-surface)', border: '1px solid var(--color-divider)',
        borderRadius: 16, boxShadow: 'var(--shadow-lg)',
        maxHeight: '64%', overflow: 'auto',
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot color={v.dotColor} size={9} />
        <b style={{ fontSize: 16 }}>{deviceEmoji(v.device) ? `${deviceEmoji(v.device)} ` : ''}{v.name}</b>
        <span className={v.tagClass}>{v.stLabel}</span>
        {v.st === 'move' && <span style={{ fontWeight: 600, fontSize: 13 }}>{v.speedLabel}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className="btn btn-secondary"
            style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 999,
              color: blocked ? 'var(--color-accent)' : '#c0392b',
              borderColor: 'currentColor',
            }}
            disabled={engineBusy || v.st === 'off'}
            title={v.st === 'off' ? 'Трекер offline' : undefined}
            onClick={askEngine}
          >
            <Icon name="power" size={13} />
            {engineBusy ? 'Отправка…' : blocked ? 'Разблокировать' : 'Блокировка'}
          </button>
          <span
            onClick={onClose}
            style={{ cursor: 'pointer', opacity: 0.6, display: 'inline-flex', padding: 4 }}
            title="Закрыть"
          >
            <Icon name="x" size={16} />
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <input
          type="date"
          className="input"
          value={day}
          max={localDate()}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          title="Выбрать любую дату"
          style={{ width: 148, minHeight: 30, borderRadius: 999, fontSize: 12, padding: '2px 12px', flex: 'none' }}
        />
        {/* от старых дней к сегодняшнему справа */}
        <div className="chip-row" ref={daysRef}>
          {lastDays(30).map(([value, weekday, label]) => (
            <span key={value} className={`chip${day === value ? ' chip-active' : ''}`} onClick={() => setDay(value)}
              style={{ flexDirection: 'column', gap: 0, lineHeight: 1.25, padding: '4px 12px' }}>
              <span style={{ fontSize: 10, opacity: 0.7, textTransform: 'capitalize' }}>{weekday}</span>
              <b style={{ fontSize: 12 }}>{label}</b>
            </span>
          ))}
        </div>
        {loadingStat && <span className="text-muted" style={{ fontSize: 12, flex: 'none' }}>Загрузка…</span>}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12.5, flexWrap: 'wrap', alignItems: 'center' }}>
        {summary && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Время в движении за день">
              <Icon name="car-front" size={13} style={{ color: 'var(--color-accent)' }} />
              <b>{hm(summary.driveMs)}</b>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Время стоянок за день">
              <b style={{ color: 'var(--color-accent-2)' }}>P</b>
              <b>{hm(summary.parkMs)}</b>
            </span>
          </>
        )}
        {shownStat && !loadingStat && (
          <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Пробег за день">
              <Icon name="route" size={13} style={{ color: 'var(--color-accent)' }} />
              <b>{kmLabel(shownStat.distanceMeters)} км</b>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Макс. скорость за период">
              <Icon name="gauge" size={13} style={{ color: 'var(--color-accent-2)' }} />
              <b>{Math.round(shownStat.maxSpeedKnots * KNOTS_TO_KMH)} км/ч</b>
            </span>
            <span
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: shownStat.overspeedCount > 0 ? '#c0392b' : 'inherit' }}
              title="Превышений лимита скорости за период"
            >
              <Icon name="triangle-alert" size={13} />
              <b>{shownStat.overspeedCount}</b>
            </span>
          </>
        )}
        {facts.map(([icon, label, value]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={label}>
            <Icon name={icon} size={13} style={{ opacity: 0.6 }} />
            <span className="text-muted">{label}:</span>
            <b style={{ fontWeight: 600 }}>{value}</b>
          </span>
        ))}
      </div>
      {p?.address && (
        <div className="text-muted" style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="map-pin" size={12} style={{ flex: 'none' }} />{p.address}
        </div>
      )}
      {timeline && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {timeline.loading && <div className="text-muted" style={{ fontSize: 12 }}>Загрузка ленты…</div>}
          {timeline.error && <div style={{ fontSize: 12, color: '#c0392b' }}>Не удалось загрузить: {timeline.error}</div>}
          {!timeline.loading && !timeline.error && timeline.rows.length === 0 && (
            <div className="text-muted" style={{ fontSize: 12 }}>За этот день данных нет</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflow: 'auto' }}>
            {timeline.rows.map((s, index) => {
              const trip = s.type === 'trip';
              const active = trip && activeTrip === index;
              return (
                <div
                  key={`${s.startTime}-${index}`}
                  onClick={() => trip && onPickTrip(s, index)}
                  title={trip ? 'Показать маршрут на карте' : undefined}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 8px',
                    borderRadius: 12, fontSize: 12.5, cursor: trip ? 'pointer' : 'default',
                    borderBottom: '1px solid var(--color-divider)',
                    ...(active ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : {}),
                  }}
                >
                  <b style={{ flex: 'none', width: 42, fontVariantNumeric: 'tabular-nums' }}>{tripTime(s.startTime)}</b>
                  <span
                    style={{
                      flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                      background: trip ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                        : 'color-mix(in srgb, var(--color-accent-2) 18%, transparent)',
                      color: trip ? 'var(--color-accent)' : 'var(--color-accent-2)',
                    }}
                  >
                    {trip ? <Icon name="car-front" size={13} /> : <b style={{ fontSize: 12 }}>P</b>}
                  </span>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="clock" size={11} style={{ opacity: 0.6 }} />{hm(s.duration)}
                      </span>
                      {trip && (
                        <>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="route" size={11} style={{ opacity: 0.6 }} />{(s.distance / 1000).toFixed(2)} км
                          </span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Icon name="gauge" size={11} style={{ opacity: 0.6 }} />
                            {Math.round(s.averageSpeed * KNOTS_TO_KMH)} км/ч
                          </span>
                        </>
                      )}
                    </div>
                    {!trip && (s.address ? (
                      <div className="text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.address}
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontStyle: 'italic', opacity: 0.7 }}>адрес определяется…</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {enginePending && (
        <ConfirmDialog
          title={enginePending.block ? 'Заблокировать двигатель?' : 'Разблокировать двигатель?'}
          body={enginePending.block
            ? `${v.name} (${v.plate}): трекер получит команду блокировки. Двигатель заглохнет, когда автомобиль остановится.`
            : `${v.name} (${v.plate}): двигатель снова можно будет завести.`}
          confirmLabel={enginePending.block ? 'Заблокировать' : 'Разблокировать'}
          danger={enginePending.block}
          onConfirm={runEngine}
          onCancel={() => setEnginePending(null)}
        />
      )}
    </div>
  );
}
