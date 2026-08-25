import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ST, vehicleState, KNOTS_TO_KMH } from './api';

const YEREVAN = [40.1792, 44.4991];

const CATEGORY_EMOJI = { bicycle: '🚲', moped: '🛵', car: '🚗', truck: '🚚', boat: '🛥️' };

function markerIcon(color, category, course, moving) {
  const emoji = CATEGORY_EMOJI[category];
  const size = emoji ? 28 : 22;
  const wrap = size + 16;
  const pad = (wrap - size) / 2;
  // у движущихся — стрелка-носик по курсу (course, градусы от севера)
  const pointer = moving ? `
    <div style="position:absolute;inset:0;transform:rotate(${Math.round(course ?? 0)}deg)">
      <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);
        width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;
        border-bottom:10px solid ${color};filter:drop-shadow(0 0 1.5px #fff)"></div>
    </div>` : '';
  return L.divIcon({
    className: '',
    iconSize: [wrap, wrap],
    iconAnchor: [wrap / 2, wrap / 2],
    html: `<div style="position:relative;width:${wrap}px;height:${wrap}px">${pointer}
      <div style="position:absolute;top:${pad}px;left:${pad}px;width:${size}px;height:${size}px;border-radius:50%;background:${color};
        border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);
        display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1">${emoji ?? ''}</div>
    </div>`,
  });
}

/**
 * Карта на Leaflet: живые маркеры устройств, трек, геозоны.
 * devices/positions — карты по id; track — массив позиций; geofences — массив Traccar-геозон.
 * focusId — id устройства, к которому надо подлететь (меняется извне).
 */
export default function LeafletMap({ devices, positions, track, geofences, focusId, focusSeq, onMarkerClick, playMarker, onMapClick, drawPoints, me, meSeq }) {
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const mapClickRef = useRef(onMapClick);
  mapClickRef.current = onMapClick;
  const drawRef = useRef(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const layersRef = useRef([]);
  const playRef = useRef(null);
  const meRef = useRef(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    // attributionControl.prefix=false убирает «Leaflet» с флагом — это реклама самой
    // библиотеки, её показывать не обязано. Ссылка на OpenStreetMap остаётся:
    // тайлы под лицензией ODbL, указание источника — её требование.
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false })
      .setView(YEREVAN, 12);
    L.control.attribution({ prefix: false, position: 'bottomleft' })
      .addAttribution('© OpenStreetMap')
      .addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.on('click', (e) => mapClickRef.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
    mapRef.current = map;
    // контейнер растягивается флексом после монтирования — без этого Leaflet
    // рисует тайлы только на первоначальный размер
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); map.remove(); };
  }, []);

  // маркеры устройств
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !devices) return;
    const markers = markersRef.current;
    const seen = new Set();
    Object.values(devices).forEach((device) => {
      const position = positions?.[device.id];
      if (!position) return;
      seen.add(device.id);
      const { st } = vehicleState(device, position);
      const speed = Math.round(position.speed * KNOTS_TO_KMH);
      const moving = st === 'move';
      const latlng = [position.latitude, position.longitude];
      const label = `<b>${device.name}</b><br>${ST[st].label}${st === 'move' ? ` · ${speed} км/ч` : ''}`;
      let marker = markers.get(device.id);
      if (!marker) {
        marker = L.marker(latlng, { icon: markerIcon(ST[st].dot, device.category, position.course, moving) }).addTo(map).bindTooltip(label);
        marker.on('click', () => clickRef.current?.(device.id));
        markers.set(device.id, marker);
      } else {
        marker.setLatLng(latlng);
        marker.setIcon(markerIcon(ST[st].dot, device.category, position.course, moving));
        marker.setTooltipContent(label);
      }
    });
    markers.forEach((marker, id) => {
      if (!seen.has(id)) { marker.remove(); markers.delete(id); }
    });
    if (!fittedRef.current && seen.size > 0) {
      fittedRef.current = true;
      const bounds = L.latLngBounds([...markers.values()].map((m) => m.getLatLng()));
      map.fitBounds(bounds.pad(0.25), { maxZoom: 14 });
    }
  }, [devices, positions]);

  // трек и геозоны
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layersRef.current.forEach((layer) => layer.remove());
    layersRef.current = [];

    if (track && track.length > 1) {
      const line = L.polyline(track.map((p) => [p.latitude, p.longitude]), {
        color: '#0C7FC3', weight: 4, opacity: 0.85,
      }).addTo(map);
      layersRef.current.push(line);
      // стрелки направления: ~15 штук равномерно вдоль трека
      const step = Math.max(1, Math.floor(track.length / 15));
      for (let i = step; i < track.length; i += step) {
        const a = track[i - 1];
        const b = track[i];
        const arrow = L.marker([b.latitude, b.longitude], {
          interactive: false,
          icon: L.divIcon({
            className: '',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
            html: `<div style="transform: rotate(${bearing(a, b)}deg); width:16px; height:16px;
              display:flex; align-items:center; justify-content:center;
              color:#0C7FC3; font-size:13px; text-shadow:0 0 2px #fff, 0 0 2px #fff">▲</div>`,
          }),
        }).addTo(map);
        layersRef.current.push(arrow);
      }
      map.fitBounds(line.getBounds().pad(0.15));
    }

    (geofences ?? []).forEach((geofence) => {
      const layer = parseArea(geofence.area);
      if (layer) {
        layer.bindTooltip(geofence.name);
        layer.addTo(map);
        layersRef.current.push(layer);
      }
    });
    if (!track && geofences?.length) {
      const group = L.featureGroup(layersRef.current);
      if (group.getLayers().length) map.fitBounds(group.getBounds().pad(0.2));
    }
  }, [track, geofences]);

  // рисование новой геозоны: пунктирный контур по кликам
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    drawRef.current?.remove();
    drawRef.current = null;
    if (!drawPoints?.length) return;
    const latlngs = drawPoints.map((p) => [p.latitude, p.longitude]);
    drawRef.current = drawPoints.length >= 3
      ? L.polygon(latlngs, { color: '#c0392b', weight: 2.5, dashArray: '6 6', fillOpacity: 0.06 })
      : L.polyline(latlngs, { color: '#c0392b', weight: 2.5, dashArray: '6 6' });
    drawRef.current.addTo(map);
  }, [drawPoints]);

  // маркер воспроизведения поездки
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!playMarker) {
      playRef.current?.remove();
      playRef.current = null;
      return;
    }
    const html = `<div style="width:26px;height:26px;border-radius:50%;background:#019178;
      border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.45);display:flex;align-items:center;
      justify-content:center;color:#fff;font-size:12px;transform:rotate(${Math.round(playMarker.course ?? 0)}deg)">▲</div>`;
    const icon = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html });
    if (!playRef.current) {
      playRef.current = L.marker([playMarker.latitude, playMarker.longitude], { icon, zIndexOffset: 1000 }).addTo(map);
    } else {
      playRef.current.setLatLng([playMarker.latitude, playMarker.longitude]);
      playRef.current.setIcon(icon);
    }
  }, [playMarker]);

  // моё местоположение: синяя точка с кругом точности
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    meRef.current?.remove();
    meRef.current = null;
    if (!me) return;
    const dot = L.divIcon({
      className: '',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#1a73e8;
        border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>`,
    });
    const group = L.layerGroup([
      L.circle([me.latitude, me.longitude], {
        radius: Math.max(me.accuracy ?? 0, 15),
        color: '#1a73e8', weight: 1, fillColor: '#1a73e8', fillOpacity: 0.12, interactive: false,
      }),
      L.marker([me.latitude, me.longitude], { icon: dot, zIndexOffset: 1200 }).bindTooltip('Вы здесь'),
    ]).addTo(map);
    meRef.current = group;
  }, [me]);

  // «показать меня» — подлетаем к своей точке по кнопке
  useEffect(() => {
    const map = mapRef.current;
    if (map && me && meSeq) map.flyTo([me.latitude, me.longitude], 15, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meSeq]);

  // фокус на устройстве
  useEffect(() => {
    const map = mapRef.current;
    const position = focusId != null ? positions?.[focusId] : null;
    if (map && position) map.flyTo([position.latitude, position.longitude], 15, { duration: 0.8 });
  }, [focusId, focusSeq]);

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />;
}

// направление между двумя точками, градусы от севера
function bearing(a, b) {
  const toRad = Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * toRad;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Traccar WKT: CIRCLE (lat lon, r) | POLYGON ((lat lon, ...)) | LINESTRING (...)
function parseArea(area) {
  // геозоны — красным, чтобы отличались от треков и маркеров
  const style = { color: '#c0392b', weight: 2.5, fillOpacity: 0.08 };
  let m = area.match(/CIRCLE\s*\(\s*([\d.-]+)\s+([\d.-]+)\s*,\s*([\d.]+)\s*\)/i);
  if (m) return L.circle([+m[1], +m[2]], { radius: +m[3], ...style });
  m = area.match(/POLYGON\s*\(\(\s*(.+)\s*\)\)/i);
  if (m) {
    const points = m[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number));
    return L.polygon(points, style);
  }
  m = area.match(/LINESTRING\s*\(\s*(.+)\s*\)/i);
  if (m) {
    const points = m[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number));
    return L.polyline(points, style);
  }
  return null;
}
