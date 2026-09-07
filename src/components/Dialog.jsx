import { useEffect, useRef, useState } from 'react'

// Свои диалоги вместо window.prompt/confirm: системные модалки доступны не везде
// (во встроенных вебвью их просто нет), да и выглядят чужеродно.

function Scrim({ children, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      {children}
    </div>
  )
}

export function Confirm({ title, text, confirmLabel = 'Удалить', onConfirm, onCancel }) {
  return (
    <Scrim onCancel={onCancel}>
      <div className="dialog dialog-narrow">
        <h2>{title}</h2>
        {text && <p className="muted">{text}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Scrim>
  )
}

export function NumberAsk({
  title,
  hint,
  presets = [],
  initial = 1,
  min = 1,
  max = 300,
  submitLabel = 'Добавить',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(String(initial))
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const n = parseInt(value, 10)
  const valid = Number.isFinite(n) && n >= min && n <= max

  const submit = (e) => {
    e.preventDefault()
    if (valid) onSubmit(n)
  }

  return (
    <Scrim onCancel={onCancel}>
      <form className="dialog dialog-narrow" onSubmit={submit}>
        <h2>{title}</h2>
        {hint && <p className="muted small">{hint}</p>}

        {presets.length > 0 && (
          <div className="chips">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className={'chip' + (n === p ? ' chip-on' : '')}
                onClick={() => setValue(String(p))}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <label className="field">
          <span>Сколько</span>
          <input
            ref={inputRef}
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Scrim>
  )
}
