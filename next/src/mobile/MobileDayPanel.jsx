import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deviceEmoji, getDeviceStats, getDeviceTimeline, hm, kmLabel, KNOTS_TO_KMH,
  lastDays, localDate, ST, telemetryFacts, timelineSummary,
} from '../api';
import { Icon } from '../ui';

const tripTime = (value) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const FACTS_KEY = 'mobileDayFacts'; // показывать ли блок показателей — выбор запоминается

/**
 * Лента выбранного дня для одной машины — мобильный вариант нижней панели
 * десктопной карты: выбор дня, телеметрия и чередование поездок и стоянок.
 * routeKey/showRoute — что сейчас нарисовано на карте ('day' | 'trip:N').
 */
export default function MobileDayPanel({ vehicle, onClose, routeKey, showRoute }) {
  const [day, setDay] = useState(() => localDate());
  const [timeline, setTimeline] = useState({ rows: [], loading: true });
  const [stat, setStat] = useState(null);
  // показатели дня и телеметрия по умолчанию свёрнуты: на телефоне это десяток строк,
  // из-за которых на ленту поездок почти не остаётся места
  const [showFacts, setShowFacts] = useState(() => localStorage.getItem(FACTS_KEY) === '1');
  const daysRef = useRef(null);

  useEffect(() => { localStorage.setItem(FACTS_KEY, showFacts ? '1' : '0'); }, [showFacts]);

  const deviceId = vehicle.device.id;
  const range = useMemo(() => ({
    from: new Date(`${day}T00:00:00`),
    to: new Date(`${day}T23:59:59.999`),
  }), [day]);

  // новая машина — снова сегодняшний день
  useEffect(() => { setDay(localDate()); }, [deviceId]);

  // сегодняшний день в конце ленты — прокручиваем к нему при открытии
  useEffect(() => {
    if (daysRef.current) daysRef.current.scrollLeft = daysRef.current.scrollWidth;
  }, [deviceId]);

  useEffect(() => {
    let alive = true;
    let retryTimer = null;
    // адреса стоянок бэкенд геокодит фоном — тихо перезапрашиваем, пока не доедут
    const refetchAddresses = (rows, attempt) => {
      const missing = rows.filter((s) => s.type === 'park' && !s.address).length;
      if (!missing || attempt >= 4) return;
      retryTimer = setTimeout(() => {
        getDeviceTimeline(deviceId, range.from, range.to)
          .then((fresh) => {
            if (!alive) return;
            setTimeline({ rows: fresh, loading: false });
            refetchAddresses(fresh, attempt + 1);
          })
          .catch(() => {});
      }, Math.min(2500 + missing * 1200, 15000));
    };
    setTimeline({ rows: [], loading: true });
    setStat(null);
    getDeviceTimeline(deviceId, range.from, range.to)
      .then((rows) => { if (alive) { setTimeline({ rows, loading: false }); refetchAddresses(rows, 0); } })
      .catch((error) => { if (alive) setTimeline({ rows: [], loading: false, error: error.message }); });
    getDeviceStats({ deviceId, from: range.from, to: range.to })
      .then((rows) => { if (alive) setStat(rows[0] ?? { distanceMeters: 0, maxSpeedKnots: 0, overspeedCount: 0 }); })
      .catch(() => { if (alive) setStat(null); });
    return () => { alive = false; clearTimeout(retryTimer); };
  }, [deviceId, range]);

  const summary = useMemo(
    () => (timeline.loading ? null : timelineSummary(timeline.rows)),
    [timeline],
  );
  const facts = telemetryFacts(vehicle.device, vehicle.position);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="veh-card" style={{ flex: 'none', margin: '8px 12px', padding: '10px 12px', gap: 8, borderRadius: 16, cursor: 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 4, flex: 'none' }} title="К списку">
            <Icon name="arrow-left" size={18} />
          </button>
          <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: vehicle.dotColor }} />
          <b style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deviceEmoji(vehicle.device) ? `${deviceEmoji(vehicle.device)} ` : ''}{vehicle.name}
          </b>
          <span className={ST[vehicle.st].tag} style={{ marginLeft: 'auto', flex: 'none' }}>{vehicle.stLabel}</span>
          {vehicle.st === 'move' && <b style={{ fontSize: 12, flex: 'none' }}>{vehicle.speed} км/ч</b>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <input
            type="date"
            className="input"
            value={day}
            max={localDate()}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            title="Выбрать любую дату"
            style={{ width: 132, minHeight: 30, borderRadius: 999, fontSize: 12, padding: '2px 10px', flex: 'none' }}
          />
          {/* от старых дней к сегодняшнему справа */}
          <div className="chip-row" ref={daysRef}>
            {lastDays(30).map(([value, weekday, label]) => (
              <span
                key={value}
                className={`chip${day === value ? ' chip-active' : ''}`}
                onClick={() => setDay(value)}
                style={{ flexDirection: 'column', gap: 0, lineHeight: 1.25, padding: '4px 12px' }}
              >
                <span style={{ fontSize: 10, opacity: 0.7, textTransform: 'capitalize' }}>{weekday}</span>
                <b style={{ fontSize: 12 }}>{label}</b>
              </span>
            ))}
          </div>
        </div>

        {showFacts && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px 14px', flexWrap: 'wrap', fontSize: 12 }}>
          {summary && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} title="В движении за день">
                <Icon name="car-front" size={12} style={{ color: 'var(--color-accent)' }} />
                <b>{hm(summary.driveMs)}</b>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} title="На стоянке за день">
                <b style={{ color: 'var(--color-accent-2)' }}>P</b>
                <b>{hm(summary.parkMs)}</b>
              </span>
            </>
          )}
          {stat && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} title="Пробег за день">
                <Icon name="route" size={12} style={{ color: 'var(--color-accent)' }} />
                <b>{kmLabel(stat.distanceMeters)} км</b>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }} title="Макс. скорость за день">
                <Icon name="gauge" size={12} style={{ color: 'var(--color-accent-2)' }} />
                <b>{Math.round(stat.maxSpeedKnots * KNOTS_TO_KMH)} км/ч</b>
              </span>
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', color: stat.overspeedCount > 0 ? '#c0392b' : 'inherit' }}
                title="Превышений лимита скорости за день"
              >
                <Icon name="triangle-alert" size={12} />
                <b>{stat.overspeedCount}</b>
              </span>
            </>
          )}
          {facts.map(([icon, label, value]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
              <Icon name={icon} size={12} style={{ opacity: 0.6 }} />
              <span className="text-muted">{label}:</span>
              <b style={{ fontWeight: 600 }}>{value}</b>
            </span>
          ))}
        </div>
        )}

        <button
          className="btn btn-ghost"
          onClick={() => setShowFacts((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '2px 8px', fontSize: 11.5, color: 'var(--color-text)', opacity: 0.7,
          }}
        >
          <Icon name={showFacts ? 'chevron-up' : 'chevron-down'} size={14} />
          {showFacts ? 'Скрыть показатели' : 'Показатели и телеметрия'}
        </button>

      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 10px' }}>
        {timeline.loading && <div className="text-muted" style={{ fontSize: 12, padding: 8 }}>Загрузка ленты…</div>}
        {timeline.error && <div style={{ fontSize: 12, padding: 8, color: '#c0392b' }}>Не удалось загрузить: {timeline.error}</div>}
        {!timeline.loading && !timeline.error && timeline.rows.length === 0 && (
          <div className="text-muted" style={{ fontSize: 12, padding: 8 }}>За этот день данных нет</div>
        )}
        {timeline.rows.length > 0 && (
        <div style={{ border: '1px solid var(--color-divider)', borderRadius: 16, background: 'var(--color-surface)', overflow: 'hidden' }}>
        {timeline.rows.map((s, index) => {
          const trip = s.type === 'trip';
          const active = trip && routeKey === `trip:${index}`;
          return (
            <div
              key={`${s.startTime}-${index}`}
              onClick={() => trip && showRoute(`trip:${index}`, new Date(s.startTime), new Date(s.endTime))}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px',
                fontSize: 12, cursor: trip ? 'pointer' : 'default',
                ...(index > 0 ? { borderTop: '1px solid var(--color-divider)' } : {}),
                ...(active ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : {}),
              }}
            >
              <b style={{ flex: 'none', width: 38, fontVariantNumeric: 'tabular-nums' }}>{tripTime(s.startTime)}</b>
              <span
                style={{
                  flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: trip ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                    : 'color-mix(in srgb, var(--color-accent-2) 18%, transparent)',
                  color: trip ? 'var(--color-accent)' : 'var(--color-accent-2)',
                }}
              >
                {trip ? <Icon name="car-front" size={12} /> : <b style={{ fontSize: 11 }}>P</b>}
              </span>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
        )}
      </div>
    </div>
  );
}
