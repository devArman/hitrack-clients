import { useEffect, useMemo, useRef, useState } from 'react';
import LeafletMap from '../LeafletMap';
import { getRoute, startOfDay } from '../api';
import { Icon } from '../ui';
import MobileDayPanel from './MobileDayPanel';
import VehicleList from './VehicleList';

const SPLIT_KEY = 'mobileMapSplit'; // доля карты по высоте, %
// точки прилипания: список на весь экран, поровну, карта во весь экран
const SNAPS = [0, 50, 82];
const nearestSnap = (value) => SNAPS.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));

export default function MobileMap({ vehicles, devices, positions, stats, trackFor, clearTrack }) {
  const [selected, setSelected] = useState(null);
  const [visibleIds, setVisibleIds] = useState(null);
  const [focus, setFocus] = useState({ id: null, seq: 0 });
  const [track, setTrack] = useState(null);
  const [routeKey, setRouteKey] = useState(null); // что нарисовано: 'day' | 'trip:N'
  const [split, setSplit] = useState(() => Number(localStorage.getItem(SPLIT_KEY)) || 50);
  const [me, setMe] = useState(null); // моё местоположение
  const [meSeq, setMeSeq] = useState(0); // счётчик нажатий — по нему карта подлетает
  const [locating, setLocating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const wrapRef = useRef(null);
  const movedRef = useRef(false); // отличаем тап по ручке от свайпа

  useEffect(() => { localStorage.setItem(SPLIT_KEY, String(Math.round(split))); }, [split]);

  const drawRoute = async (key, from, to, deviceId) => {
    setRouteKey(key);
    try {
      const route = await getRoute(deviceId, from, to);
      setTrack(route.length > 1 ? route : null);
    } catch { setTrack(null); }
  };

  // повторное нажатие на ту же кнопку/поездку снимает маршрут с карты
  const showRoute = (key, from, to) => {
    if (routeKey === key) { setTrack(null); setRouteKey(null); return; }
    drawRoute(key, from, to, selected);
  };

  // «построить трек» из карточки объекта
  useEffect(() => {
    if (trackFor == null) return;
    setSelected(trackFor);
    drawRoute('day', startOfDay(), new Date(), trackFor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackFor]);

  const pick = (id) => {
    if (id !== selected) {
      setTrack(null);
      setRouteKey(null);
      clearTrack();
    }
    setSelected(id);
    setFocus((f) => ({ id, seq: f.seq + 1 }));
  };

  const closePanel = () => {
    setSelected(null);
    setTrack(null);
    setRouteKey(null);
    clearTrack();
  };

  // пока открыта лента дня — на карте только выбранная машина,
  // иначе маркеры повторяют фильтр списка
  const [mapDevices, mapPositions] = useMemo(() => {
    if (selected == null && !visibleIds) return [devices, positions];
    const ids = new Set(selected != null ? [selected] : visibleIds);
    return [
      Object.fromEntries(Object.entries(devices).filter(([id]) => ids.has(Number(id)))),
      Object.fromEntries(Object.entries(positions).filter(([id]) => ids.has(Number(id)))),
    ];
  }, [visibleIds, devices, positions, selected]);

  const vehicle = selected != null ? vehicles.find((v) => v.device.id === selected) : null;

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setMeSeq((n) => n + 1);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  // свайп по ручке тянет нижний блок вверх/вниз, на отпускании — прилипание
  const startDrag = (e) => {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    setDragging(true);
    movedRef.current = false;
    const start = e.clientY;
    const move = (ev) => {
      if (Math.abs(ev.clientY - start) > 4) movedRef.current = true;
      setSplit(Math.min(SNAPS[SNAPS.length - 1], Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      setSplit(nearestSnap);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // тап по ручке — переключение между «поровну» и «список во весь экран»
  const toggleSheet = () => {
    if (movedRef.current) return; // это был свайп, а не тап
    setSplit((v) => (v > 4 ? 0 : 50));
  };
  const collapsed = split < 4;

  const round = { width: 40, height: 40, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%', boxShadow: 'var(--shadow-sm)' };

  return (
    <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* верхняя половина — карта отдельной карточкой, как списки ниже */}
      <div style={{
        height: `${split}%`, flex: 'none', display: collapsed ? 'none' : 'flex', minHeight: 0, padding: '4px 12px 0',
        transition: dragging ? 'none' : 'height .2s ease',
      }}>
        <div style={{
          flex: 1, position: 'relative', display: 'flex', minHeight: 0, minWidth: 0,
          borderRadius: 18, overflow: 'hidden',
          border: '1px solid var(--color-divider)', boxShadow: 'var(--shadow-sm)',
        }}>
          <LeafletMap
            devices={mapDevices}
            positions={mapPositions}
            track={track}
            focusId={focus.id}
            focusSeq={focus.seq}
            onMarkerClick={pick}
            me={me}
            meSeq={meSeq}
          />
          <button
            onClick={locate}
            title="Показать моё местоположение"
            style={{
              ...round, position: 'absolute', right: 10, bottom: 26, zIndex: 1000, border: '1px solid var(--color-divider)',
              background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
              color: me ? 'var(--color-accent)' : 'var(--color-text)',
              opacity: locating ? 0.6 : 1, cursor: 'pointer', padding: 0,
            }}
          >
            <Icon name="locate-fixed" size={19} />
          </button>
        </div>
      </div>

      {/* граница — тянется пальцем */}
      <div
        onPointerDown={startDrag}
        onClick={toggleSheet}
        title={collapsed ? 'Показать карту' : 'Развернуть список'}
        style={{
          flex: 'none', height: 24, display: 'grid', placeItems: 'center',
          cursor: 'row-resize', touchAction: 'none', background: 'var(--color-bg)',
        }}
      >
        <span style={{ width: 44, height: 5, borderRadius: 999, background: 'color-mix(in srgb, var(--color-text) 30%, transparent)' }} />
      </div>

      {/* нижняя половина — список устройств или лента дня выбранного */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-bg)' }}>
        {vehicle ? (
          <MobileDayPanel
            vehicle={vehicle}
            onClose={closePanel}
            routeKey={routeKey}
            showRoute={showRoute}
          />
        ) : (
          <VehicleList vehicles={vehicles} stats={stats} selectedId={selected} onPick={pick} onVisible={setVisibleIds} />
        )}
      </div>
    </div>
  );
}
