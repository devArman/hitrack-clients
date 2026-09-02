import { useState } from 'react';
import { logout as apiLogout, updateMe } from '../api';
import { Blueprint, ConfirmDialog, Icon } from '../ui';

const PRICE_PER_TRACKER = 3000;
const MIN_PASSWORD = 6; // столько же требует UpdateMeDto на бэкенде

const money = (n) => n.toLocaleString('ru-RU');

const plural = (n, one, few, many) => {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
};

// бэкенд принимает в phone любую строку, поэтому проверяем на клиенте:
// плюс, цифры, пробелы, скобки и дефисы — и 8…15 цифр, как в E.164
const phoneError = (value) => {
  const text = value.trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(text)) return 'Только цифры, пробелы, скобки и дефис';
  if (digits.length < 8 || digits.length > 15) return 'Похоже на неполный номер';
  return null;
};

const THEMES = [['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon']];

export default function MobileProfile({ user, setUser, vehicles, theme, setTheme, initials }) {
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [status, setStatus] = useState(null); // null | 'saving' | 'saved'
  const [error, setError] = useState(null);
  const [askLogout, setAskLogout] = useState(false);

  const trackers = vehicles.length;

  const nameError = name.trim() ? null : 'Имя не может быть пустым';
  const phoneMessage = phoneError(phone);
  const passwordMessage = !password
    ? null
    : password.length < MIN_PASSWORD ? `Минимум ${MIN_PASSWORD} символов`
    : password !== repeat ? 'Пароли не совпадают'
    : null;

  // старые записи могли попасть в базу без всякой проверки (там встречается даже e-mail).
  // Подсказку показываем всегда, но сохранение блокируем, только если поле правили —
  // иначе из-за чужого мусора нельзя было бы поменять даже имя.
  const phoneTouched = phone.trim() !== (user.phone ?? '');
  const dirty = name.trim() !== (user.name ?? '') || phoneTouched || Boolean(password);
  const canSave = dirty && !nameError && !(phoneMessage && phoneTouched)
    && !passwordMessage && status !== 'saving';

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setStatus('saving');
    setError(null);
    try {
      const patch = { name: name.trim(), phone: phone.trim() };
      if (password) patch.password = password;
      setUser(await updateMe(patch));
      setPassword('');
      setRepeat('');
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? null : s)), 2500);
    } catch (err) {
      setStatus(null);
      setError(err.message);
    }
  };

  const logout = async () => {
    await apiLogout();
    window.location.reload();
  };

  return (
    <div style={{
      flex: 1, overflow: 'auto',
      padding: '10px 14px calc(20px + env(safe-area-inset-bottom))',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      {/* кто вошёл: аватар в шапке шелла на этой вкладке скрыт, дублирования нет */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 54, height: 54, flex: 'none', display: 'grid', placeItems: 'center',
          borderRadius: '50%', background: 'var(--grad-brand)', color: '#fff',
          fontFamily: 'var(--font-heading)', fontSize: 21, boxShadow: 'var(--shadow-sm)',
        }}>
          {initials}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-heading)', fontSize: 20, lineHeight: 1.15,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {user.name || user.email}
          </div>
          <div className="text-muted" style={{
            fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {user.email}
          </div>
        </div>
      </div>

      {/* главное число — сколько выходит в месяц за весь парк, а не цена за штуку */}
      <Blueprint style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="card-title" style={{ color: 'var(--color-accent)' }}>Тариф</div>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 30, lineHeight: 1.1 }}>
          {money(trackers * PRICE_PER_TRACKER)} ֏ <span className="text-muted" style={{ fontSize: 14 }}>/ мес</span>
        </div>
        <div className="text-muted" style={{ fontSize: 12.5 }}>
          {money(PRICE_PER_TRACKER)} ֏ × {trackers} {plural(trackers, 'трекер', 'трекера', 'трекеров')}
          {' · '}оборудование и поддержка включены
        </div>
      </Blueprint>

      <form className="card" onSubmit={save}>
        <div className="card-title">Личные данные</div>

        <div className="field">
          <label htmlFor="pf-name">Имя</label>
          <input
            id="pf-name" className="input" value={name} autoComplete="name" enterKeyHint="next"
            style={nameError ? { borderColor: 'var(--color-danger)' } : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {nameError && <div className="field-error">{nameError}</div>}
        </div>

        <div className="field">
          <label htmlFor="pf-phone">Телефон</label>
          <input
            id="pf-phone" className="input" type="tel" inputMode="tel" autoComplete="tel"
            placeholder="+374 XX XXXXXX" value={phone} enterKeyHint="next"
            style={phoneMessage ? { borderColor: 'var(--color-danger)' } : undefined}
            onChange={(e) => setPhone(e.target.value)}
          />
          {phoneMessage && <div className="field-error">{phoneMessage}</div>}
        </div>

        <div className="field">
          <label htmlFor="pf-email">Email · логин</label>
          <input id="pf-email" className="input" value={user.email} disabled />
        </div>

        <div className="card-divider" />
        <div className="card-title">Смена пароля</div>

        <div className="field">
          <label htmlFor="pf-password">Новый пароль</label>
          <input
            id="pf-password" className="input" type="password" autoComplete="new-password"
            placeholder="Оставьте пустым, чтобы не менять" value={password} enterKeyHint="next"
            style={passwordMessage ? { borderColor: 'var(--color-danger)' } : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {password && (
          <div className="field">
            <label htmlFor="pf-repeat">Повторите пароль</label>
            <input
              id="pf-repeat" className="input" type="password" autoComplete="new-password"
              value={repeat} enterKeyHint="done"
              style={passwordMessage ? { borderColor: 'var(--color-danger)' } : undefined}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
        )}
        {passwordMessage && <div className="field-error" style={{ marginTop: 0 }}>{passwordMessage}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={!canSave}>
            {status === 'saving' ? 'Сохранение…' : 'Сохранить'}
          </button>
          {status === 'saved' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--color-accent)' }}>
              <Icon name="check" size={14} />Сохранено
            </span>
          )}
          {!dirty && status !== 'saved' && (
            <span className="text-muted" style={{ fontSize: 12 }}>Изменений нет</span>
          )}
        </div>
        {error && <div className="field-error" style={{ marginTop: 0 }}>{error}</div>}
      </form>

      <div className="card">
        <div className="card-title">Оформление</div>
        {/* сегмент вместо кнопки-переключателя: видно, какая тема сейчас включена */}
        <div className="seg" style={{ display: 'flex' }}>
          {THEMES.map(([id, label, icon]) => (
            <span
              key={id}
              className="seg-opt"
              onClick={() => setTheme(id)}
              style={{
                flex: 1, justifyContent: 'center', padding: '9px 12px',
                ...(theme === id ? { background: 'var(--color-accent)', color: 'var(--color-bg)' } : {}),
              }}
            >
              <Icon name={icon} size={15} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="btn btn-danger btn-block"
        style={{ marginTop: 0 }}
        onClick={() => setAskLogout(true)}
      >
        <Icon name="log-out" size={15} />
        Выйти
      </button>

      {askLogout && (
        <ConfirmDialog
          title="Выйти из аккаунта?"
          body="Чтобы вернуться, понадобится email и пароль."
          confirmLabel="Выйти"
          danger
          onConfirm={logout}
          onCancel={() => setAskLogout(false)}
        />
      )}
    </div>
  );
}
