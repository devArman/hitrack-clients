import { useEffect, useMemo, useState } from 'react';
import { deviceEmoji, fuelLevel, fuelLiters, kmLabel, KNOTS_TO_KMH, ST, timeAgo } from '../api';
import { Icon } from '../ui';

const CONN = [['all', 'Все'], ['online', 'Online'], ['off', 'Offline']];

/**
 * Общий список объектов для мобильных вкладок: поиск, фильтр по связи,
 * сортировка online → offline и карточка с суточной статистикой.
 * onPick — что делать по нажатию (на карте открыть ленту дня, во вкладке — карточку).
 */
export default function VehicleList({ vehicles, stats, selectedId, onPick, onVisible, showAddress }) {
  const [search, setSearch] = useState('');
  const [conn, setConn] = useState('all');

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter((v) => v.name.toLowerCase().includes(q) || String(v.plate).toLowerCase().includes(q));
  }, [search, vehicles]);

  const counts = useMemo(() => ({
    all: found.length,
    online: found.filter((v) => v.st !== 'off').length,
    off: found.filter((v) => v.st === 'off').length,
  }), [found]);

  const filtered = useMemo(() => found
    .filter((v) => {
      if (conn === 'online') return v.st !== 'off';
      if (conn === 'off') return v.st === 'off';
      return true;
    })
    // сначала online, потом offline; внутри — по названию
    .sort((a, b) => (a.st === 'off') - (b.st === 'off') || a.name.localeCompare(b.name)),
  [found, conn]);

  // родителю (карте) нужно знать, что осталось после фильтров — по этим id рисуются маркеры
  const visibleIds = useMemo(() => filtered.map((v) => v.device.id), [filtered]);
  useEffect(() => { onVisible?.(visibleIds); }, [visibleIds, onVisible]);

  return (
    <>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, flex: 'none' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.45 }} />
          <input
            className="input"
            placeholder="Поиск объекта…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ borderRadius: 999, minHeight: 38, paddingLeft: 32, fontSize: 14 }}
          />
        </div>
        <div className="chip-row">
          {CONN.map(([id, label]) => (
            <span key={id} className={`chip${conn === id ? ' chip-active' : ''}`} onClick={() => setConn(id)}>
              {label} <span className="count">{counts[id]}</span>
            </span>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map((v) => {
          const fuel = fuelLevel(v.position);
          const liters = fuelLiters(v.position);
          const updated = timeAgo(v.position?.deviceTime ?? v.device.lastUpdate);
          const stat = stats[v.device.id];
          const address = showAddress ? v.position?.address : null;
          return (
            <div
              key={v.device.id}
              data-id={v.device.id}
              className={`veh-card${selectedId === v.device.id ? ' veh-card-active' : ''}`}
              onClick={() => onPick(v.device.id)}
              // flex: none — иначе карточки в скроллящейся колонке ужимаются и текст наезжает
              style={{ flex: 'none', padding: '10px 12px', gap: 6, borderRadius: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: v.dotColor }} />
                <b style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {deviceEmoji(v.device) ? `${deviceEmoji(v.device)} ` : ''}{v.name}
                </b>
                <span className={ST[v.st].tag} style={{ flex: 'none' }}>{v.stLabel}</span>
                {v.st === 'move' && <b style={{ flex: 'none' }}>{v.speed} км/ч</b>}
                {updated && (
                  <span className="text-muted" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                    <Icon name="clock" size={11} />{updated}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Пробег за сегодня">
                  <Icon name="route" size={12} style={{ color: 'var(--color-accent)' }} />
                  <b>{stat ? `${kmLabel(stat.distanceMeters)} км` : '— км'}</b>
                </span>
                {stat && (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Макс. скорость за сегодня">
                      <Icon name="gauge" size={12} style={{ color: 'var(--color-accent-2)' }} />
                      <b>{Math.round(stat.maxSpeedKnots * KNOTS_TO_KMH)} км/ч</b>
                    </span>
                    <span
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: stat.overspeedCount > 0 ? '#c0392b' : 'inherit' }}
                      title="Превышений лимита скорости за сегодня"
                    >
                      <Icon name="triangle-alert" size={12} />
                      <b>{stat.overspeedCount}</b>
                    </span>
                  </>
                )}
                {fuel != null && (
                  <span className="text-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="fuel" size={12} />{fuel}%{liters != null && ` · ${liters} л`}
                  </span>
                )}
              </div>
              {address && (
                <div className="text-muted" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="map-pin" size={11} style={{ flex: 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{address}</span>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-muted" style={{ fontSize: 13, padding: 8 }}>Нет объектов по выбранным фильтрам</div>}
      </div>
    </>
  );
}
