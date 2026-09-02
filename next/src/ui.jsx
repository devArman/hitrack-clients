// Мелкие общие элементы дизайн-системы

const ICONS = 'https://unpkg.com/lucide-static@0.462.0/icons/';

export function Icon({ name, size = 17, style }) {
  return (
    <span
      style={{
        width: size, height: size, flex: 'none', background: 'currentColor',
        mask: `url('${ICONS}${name}.svg') center / contain no-repeat`,
        WebkitMask: `url('${ICONS}${name}.svg') center / contain no-repeat`,
        display: 'inline-block',
        ...style,
      }}
    />
  );
}

export function Blueprint({ style, children, ...rest }) {
  return (
    <div className="blueprint" style={style} {...rest}>
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      {children}
    </div>
  );
}

export function StatusDot({ color, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', flex: 'none', background: color }} />;
}

export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">{body}</div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Отмена</button>
          <button
            className="btn btn-primary"
            style={danger ? { background: 'var(--color-danger)', borderColor: 'var(--color-danger)' } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
