import { useEffect, useState } from 'react';
import LeafletMap from '../LeafletMap';
import {
  fuelLevel, fuelLiters, getDeviceSettings, getDeviceStats, getDeviceTimeline, getSummary,
  hm, kmLabel, KNOTS_TO_KMH, saveDeviceSettings, sendCommand, startOfDay, telemetryFacts, timelineSummary,
} from '../api';
import { ConfirmDialog, Icon } from '../ui';

export default function MobileDetail({ vehicle, positions, onClose, onBuildTrack }) {
  const [stats, setStats] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limits, setLimits] = useState({ speed: '', fuel: '', status: null });

  useEffect(() => {
    if (!vehicle) return;
    getDeviceSettings().then((list) => {
      const s = list.find((x) => x.deviceId === vehicle.device.id);
      setLimits({ speed: s?.speedLimitKmh ?? '', fuel: s?.minFuelLiters ?? '', status: null });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.device.id]);

  useEffect(() => {
    if (!vehicle) return;
    const from = startOfDay();
    const to = new Date();
    Promise.all([
      getDeviceStats({ deviceId: vehicle.device.id, from, to }),
      getDeviceTimeline(vehicle.device.id, from, to),
      getSummary([vehicle.device.id], from, to),
    ]).then(([statRows, timeline, summary]) => {
      const stat = statRows[0] ?? {};
      const day = timelineSummary(timeline);
      const row = summary[0] ?? {};
      setStats({
        km: kmLabel(stat.distanceMeters ?? 0),
        maxSpeed: stat.maxSpeedKnots ? Math.round(stat.maxSpeedKnots * KNOTS_TO_KMH) : 0,
        overspeed: stat.overspeedCount ?? 0,
        driveMs: day?.driveMs ?? 0,
        parkMs: day?.parkMs ?? 0,
        trips: day?.trips ?? 0,
        hours: row.engineHours ? (row.engineHours / 3600000).toFixed(1) : null,
      });
    }).catch(() => setStats({}));
    // разово при открытии карточки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.device.id]);

  if (!vehicle) return null;

  const fuel = fuelLevel(vehicle.position);
  const blocked = Boolean(vehicle.position?.attributes?.blocked);
  const address = vehicle.position?.address
    ?? (vehicle.position ? `${vehicle.position.latitude.toFixed(4)}, ${vehicle.position.longitude.toFixed(4)}` : '—');

  const cards = [
    { k: 'Пробег сегодня', v: stats ? `${stats.km ?? 0} км` : '…' },
    { k: 'Макс. скорость', v: stats ? `${stats.maxSpeed ?? 0} км/ч` : '…' },
    { k: 'В движении', v: stats ? hm(stats.driveMs) : '…' },
    { k: 'На стоянке', v: stats ? hm(stats.parkMs) : '…' },
    { k: 'Превышения', v: stats ? `${stats.overspeed ?? 0}` : '…', warn: stats?.overspeed > 0 },
    { k: 'Поездок сегодня', v: stats ? `${stats.trips ?? 0}` : '…' },
    ...(stats?.hours ? [{ k: 'Моточасы', v: `${stats.hours} ч`, wide: true }] : []),
  ];

  const facts = telemetryFacts(vehicle.device, vehicle.position);

  const toggleEngine = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      await sendCommand(vehicle.device.id, blocked ? 'engineResume' : 'engineStop');
      alert(blocked ? 'Команда разблокировки отправлена.' : 'Команда блокировки отправлена. Двигатель заглохнет после остановки.');
    } catch (error) {
      alert(`Не удалось отправить команду: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const one = { [vehicle.device.id]: vehicle.device };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 1100, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 12px 12px', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><Icon name="arrow-left" size={18} /></button>
        <b style={{ fontSize: 17, fontFamily: 'var(--font-heading)', letterSpacing: '.02em' }}>{vehicle.name}</b>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{vehicle.plate}</span>
      </div>
      <div style={{ height: 180, position: 'relative', border: '1px solid var(--color-divider)', borderRadius: 10, overflow: 'hidden', display: 'flex', flex: 'none' }}>
        <LeafletMap devices={one} positions={positions} focusId={vehicle.device.id} focusSeq={1} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: vehicle.dotColor }} />
        <b style={{ fontSize: 17, fontFamily: 'var(--font-heading)', letterSpacing: '.02em' }}>{vehicle.stLine}</b>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12, textAlign: 'right' }}>{address}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {cards.map((c) => (
          <div key={c.k} style={{ border: '1px solid var(--color-divider)', borderRadius: 10, padding: 10, ...(c.wide ? { gridColumn: '1 / -1' } : {}) }}>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>{c.k}</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, ...(c.warn ? { color: '#c0392b' } : {}) }}>{c.v}</div>
          </div>
        ))}
      </div>
      <div style={{ border: '1px solid var(--color-divider)', borderRadius: 10, padding: 12, display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 12.5 }}>
        {facts.map(([icon, label, value]) => (
          <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
            <Icon name={icon} size={12} style={{ opacity: 0.6 }} />
            <span className="text-muted">{label}:</span>
            <b style={{ fontWeight: 600 }}>{value}</b>
          </span>
        ))}
      </div>
      {fuel != null && (
        <div style={{ border: '1px solid var(--color-divider)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span className="text-muted">Топливо (ДУТ)</span>
            <b>{fuel}%{fuelLiters(vehicle.position) != null && ` · ${fuelLiters(vehicle.position)} л`}</b>
          </div>
          <div style={{ height: 6, background: 'color-mix(in srgb, var(--color-text) 12%, transparent)' }}>
            <div style={{ height: '100%', width: `${fuel}%`, background: 'var(--grad-brand)' }} />
          </div>
        </div>
      )}
      <div style={{ border: '1px solid var(--color-divider)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-accent)' }}>Лимиты</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Скорость, км/ч</label>
            <input className="input" type="number" value={limits.speed}
              onChange={(e) => setLimits({ ...limits, speed: e.target.value, status: null })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Мин. топливо, л</label>
            <input className="input" type="number" value={limits.fuel} disabled={fuel == null}
              onChange={(e) => setLimits({ ...limits, fuel: e.target.value, status: null })} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                await saveDeviceSettings(vehicle.device.id, {
                  speedLimitKmh: limits.speed === '' ? null : Number(limits.speed),
                  minFuelLiters: limits.fuel === '' ? null : Number(limits.fuel),
                });
                setLimits({ ...limits, status: 'ok' });
              } catch {
                setLimits({ ...limits, status: 'err' });
              }
            }}>
            Сохранить лимиты
          </button>
          {limits.status === 'ok' && <span style={{ fontSize: 12, color: 'var(--color-accent)' }}>Сохранено</span>}
          {limits.status === 'err' && <span style={{ fontSize: 12, color: '#c0392b' }}>Ошибка</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button className="btn btn-primary" style={{ flex: 1, padding: '12px 0', letterSpacing: '.05em' }} onClick={onBuildTrack}>
          ПОСТРОИТЬ ТРЕК
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1, padding: '12px 0', letterSpacing: '.05em' }}
          disabled={busy || vehicle.st === 'off'}
          onClick={() => setConfirming(true)}
        >
          {busy ? 'ОТПРАВКА…' : blocked ? 'РАЗБЛОКИРОВКА' : 'БЛОКИРОВКА'}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={blocked ? 'Разблокировать двигатель?' : 'Заблокировать двигатель?'}
          body={blocked
            ? `${vehicle.name}: двигатель снова можно будет завести.`
            : `${vehicle.name}: трекер получит команду блокировки. Двигатель заглохнет, когда автомобиль остановится.`}
          confirmLabel={blocked ? 'Разблокировать' : 'Заблокировать'}
          danger={!blocked}
          onConfirm={toggleEngine}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
