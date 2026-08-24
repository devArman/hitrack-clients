// Клиент hitrac-api (/v2): наш JWT, устройства и позиции из нашей БД,
// Traccar-специфика (отчёты, команды, геозоны) — через прокси нашего бэкенда.

const TOKEN_KEY = 'ht_token';

export async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`/v2${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    throw new Error('unauthorized');
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).message ?? message; } catch { /* not json */ }
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return response;
}

export const getJson = (path) => api(path).then((r) => r.json());

export const getSession = () => {
  if (!localStorage.getItem(TOKEN_KEY)) return Promise.reject(new Error('no token'));
  return getJson('/me');
};

export const login = async (email, password) => {
  const response = await fetch('/v2/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('bad credentials');
  const result = await response.json();
  localStorage.setItem(TOKEN_KEY, result.accessToken);
  return result.user;
};

export const logout = () => {
  localStorage.removeItem(TOKEN_KEY);
  return Promise.resolve();
};

export const sendCommand = (deviceId, type) =>
  api('/commands/send', { method: 'POST', body: JSON.stringify({ deviceId, type }) });

export const updateMe = (patch) =>
  api('/me', { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.json());

export const getDeviceGroups = () => getJson('/device-groups');
export const createDeviceGroup = (data) =>
  api('/device-groups', { method: 'POST', body: JSON.stringify(data) }).then((r) => r.json());
export const updateDeviceGroup = (id, data) =>
  api(`/device-groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then((r) => r.json());
export const deleteDeviceGroup = (id) => api(`/device-groups/${id}`, { method: 'DELETE' });
export const getDeviceSettings = () => getJson('/device-settings');
export const saveDeviceSettings = (deviceId, settings) =>
  api(`/device-settings/${deviceId}`, { method: 'POST', body: JSON.stringify(settings) }).then((r) => r.json());
export const getAlerts = (params = '') => getJson(`/alerts${params}`);

const query = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    (Array.isArray(v) ? v : [v]).forEach((x) => q.append(k, x));
  });
  return q.toString();
};

// статистика за период (пробег, макс. скорость, превышения);
// без опций — с начала дня клиента по всем устройствам
export const getDeviceStats = (opts = {}) => {
  const params = { from: (opts.from ?? startOfDay()).toISOString() };
  if (opts.to) params.to = opts.to.toISOString();
  if (opts.deviceId) params.deviceId = opts.deviceId;
  return getJson(`/device-stats?${query(params)}`);
};

// лента дня: чередование поездок и стоянок с адресами
export const getDeviceTimeline = (deviceId, from, to) =>
  getJson(`/device-timeline?${query({ deviceId, from: from.toISOString(), to: to.toISOString() })}`);

export const getTrips = (deviceId, from, to) =>
  getJson(`/reports/trips?${query({ deviceId, from: from.toISOString(), to: to.toISOString() })}`);

export const getRoute = (deviceId, from, to) =>
  getJson(`/reports/route?${query({ deviceId, from: from.toISOString(), to: to.toISOString() })}`);

export const getSummary = (deviceIds, from, to) =>
  getJson(`/reports/summary?${query({ deviceId: deviceIds, from: from.toISOString(), to: to.toISOString() })}`);

export const getEvents = (deviceIds, from, to) =>
  getJson(`/reports/events?${query({ deviceId: deviceIds, from: from.toISOString(), to: to.toISOString() })}`);

// ── производные значения ──

export const CATEGORY_EMOJI = { bicycle: '🚲', moped: '🛵', car: '🚗', truck: '🚚', boat: '🛥️' };
export const deviceEmoji = (device) => CATEGORY_EMOJI[device?.category] ?? null;

export const KNOTS_TO_KMH = 1.852;

// человекочитаемые названия тревог Traccar (attributes.alarm)
export const ALARM_NAMES = {
  hardAcceleration: 'резкое ускорение',
  hardBraking: 'резкое торможение',
  hardCornering: 'резкий поворот',
  overspeed: 'превышение скорости',
  powerCut: 'отключение питания',
  powerRestored: 'питание восстановлено',
  lowBattery: 'низкий заряд батареи',
  lowPower: 'низкое питание',
  vibration: 'вибрация',
  tow: 'буксировка',
  sos: 'SOS',
};
export const alarmName = (alarm) => ALARM_NAMES[alarm] ?? alarm ?? '';

// «превышение скорости — 92 км/ч при лимите 60 км/ч»
export function overspeedText(event) {
  const a = event.attributes ?? {};
  const speed = typeof a.speed === 'number' ? Math.round(a.speed * KNOTS_TO_KMH) : null;
  const limit = typeof a.speedLimit === 'number' ? Math.round(a.speedLimit * KNOTS_TO_KMH) : null;
  if (speed != null && limit != null) return `превышение скорости — ${speed} км/ч при лимите ${limit} км/ч`;
  if (limit != null) return `превышение скорости — лимит ${limit} км/ч`;
  return 'превышение скорости';
}

// типы событий: подпись, класс тега и текст строки
export const EVENT_KINDS = {
  deviceOverspeed: { type: 'Скорость', tagClass: 'tag tag-outline', text: (e) => overspeedText(e) },
  geofenceExit: { type: 'Геозона', tagClass: 'tag tag-accent-2', text: (e, zones) => `выезд из геозоны${zones?.[e.geofenceId] ? ` «${zones[e.geofenceId]}»` : ''}` },
  geofenceEnter: { type: 'Геозона', tagClass: 'tag tag-accent-2', text: (e, zones) => `въезд в геозону${zones?.[e.geofenceId] ? ` «${zones[e.geofenceId]}»` : ''}` },
  deviceFuelDrop: { type: 'Топливо', tagClass: 'tag tag-outline', text: () => 'резкое падение уровня топлива' },
  deviceFuelIncrease: { type: 'Топливо', tagClass: 'tag tag-accent', text: () => 'заправка' },
  deviceOffline: { type: 'Связь', tagClass: 'tag tag-neutral', text: () => 'потеря связи' },
  deviceUnknown: { type: 'Связь', tagClass: 'tag tag-neutral', text: () => 'нет данных от трекера' },
  deviceOnline: { type: 'Связь', tagClass: 'tag tag-accent', text: () => 'снова на связи' },
  deviceMoving: { type: 'Движение', tagClass: 'tag tag-accent', text: () => 'начало движения' },
  deviceStopped: { type: 'Движение', tagClass: 'tag tag-accent-2', text: () => 'остановка' },
  ignitionOn: { type: 'Зажигание', tagClass: 'tag tag-accent', text: () => 'зажигание включено' },
  ignitionOff: { type: 'Зажигание', tagClass: 'tag tag-accent-2', text: () => 'зажигание выключено' },
  alarm: { type: 'Тревога', tagClass: 'tag tag-outline', text: (e) => `тревога: ${alarmName(e.attributes?.alarm)}` },
  fuelLow: { type: 'Топливо', tagClass: 'tag tag-outline', text: (e) => e.message },
  towing: { type: 'Эвакуатор', tagClass: 'tag tag-outline', text: (e) => e.message },
};

export const eventKind = (type) => EVENT_KINDS[type] ?? { type, tagClass: 'tag tag-neutral', text: () => '' };

// критичные по умолчанию — пока клиент не настроил своё
export const DEFAULT_CRITICAL = new Set(['alarm', 'towing', 'fuelLow']);

// настройки клиента: показывать ли тип и считать ли его критичным
export function alertPrefs(user) {
  const prefs = user?.prefs?.alerts ?? {};
  const zones = user?.prefs?.geofenceExit ?? {};
  const zoneMode = (e) => (e.type === 'geofenceExit' ? zones[e.geofenceId] : undefined);
  return {
    zoneMode,
    show: (e) => (zoneMode(e) === 'hidden' ? false : (prefs[e.type]?.show ?? true) || zoneMode(e) === 'critical'),
    critical: (e) => (zoneMode(e) ? zoneMode(e) === 'critical' : prefs[e.type]?.critical ?? DEFAULT_CRITICAL.has(e.type)),
  };
}

export function vehicleState(device, position) {
  const speed = position ? Math.round(position.speed * KNOTS_TO_KMH) : 0;
  if (device.status !== 'online') return { st: 'off', speed: 0 };
  return speed > 3 ? { st: 'move', speed } : { st: 'park', speed: 0 };
}

export const ST = {
  move: { label: 'Движется', tag: 'tag tag-accent', dot: '#01a586' },
  park: { label: 'Стоянка', tag: 'tag tag-accent-2', dot: '#0c7fc3' },
  off: { label: 'Offline', tag: 'tag tag-neutral', dot: '#98989b' },
};

export function fuelLiters(position) {
  const value = position?.attributes?.fuelLiters;
  return value == null ? null : Math.round(value);
}

export function fuelLevel(position) {
  const a = position?.attributes ?? {};
  const value = a.fuel ?? a.fuelLevel ?? a.fuel1 ?? null;
  return value == null ? null : Math.round(value);
}

export function formatTime(value) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// «5 мин назад» — короткое относительное время для карточек
export function timeAgo(value) {
  if (!value) return null;
  const sec = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} дн назад` : formatTime(value);
}

export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// локальная дата YYYY-MM-DD (toISOString даёт UTC и сдвигает день)
export function localDate(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// последние N дней для выбора: [YYYY-MM-DD, 'Пт', '21 авг']
export const lastDays = (count = 7) => Array.from({ length: count }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (count - 1 - i));
  return [
    localDate(d),
    d.toLocaleDateString('ru-RU', { weekday: 'short' }),
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
  ];
});

// «2 ч 52 мин»
export const hm = (ms) => {
  const min = Math.round((ms ?? 0) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;
};

// до 10 км — с десятыми, дальше целые
export const kmLabel = (meters) => (meters >= 10000
  ? Math.round(meters / 1000)
  : Math.round((meters ?? 0) / 100) / 10);

// в движении / на стоянке за день — суммы по ленте getDeviceTimeline
export function timelineSummary(rows) {
  if (!rows?.length) return null;
  const sum = (type) => rows.filter((s) => s.type === type).reduce((acc, s) => acc + s.duration, 0);
  return { driveMs: sum('trip'), parkMs: sum('park'), trips: rows.filter((s) => s.type === 'trip').length };
}

// телеметрия трекера: [иконка, подпись, значение] — пустые поля отброшены
export function telemetryFacts(device, position) {
  const a = position?.attributes ?? {};
  const volts = (x) => `${Math.round(x * 10) / 10} В`;
  const yesNo = (x) => (x ? 'Вкл' : 'Выкл');
  const fuel = fuelLevel(position);
  const liters = fuelLiters(position);
  const updated = position?.deviceTime ?? device?.lastUpdate;
  return [
    ['cpu', 'Модель', device?.model],
    ['user', 'Водитель', device?.attributes?.driver ?? device?.contact],
    ['satellite', 'Спутники', a.sat],
    ['key', 'Зажигание', a.ignition != null ? yesNo(a.ignition) : null],
    ['navigation', 'Движение', a.motion != null ? yesNo(a.motion) : null],
    ['zap', 'Питание', a.power != null ? volts(a.power) : null],
    ['battery-medium', 'Батарея', a.battery != null ? volts(a.battery) : null],
    ['fuel', 'Топливо', fuel != null ? `${fuel}%${liters != null ? ` · ${liters} л` : ''}` : null],
    ['clock', 'Обновлено', updated ? `${formatTime(updated)} (${timeAgo(updated)})` : null],
  ].filter((f) => f[2] != null && f[2] !== '');
}
