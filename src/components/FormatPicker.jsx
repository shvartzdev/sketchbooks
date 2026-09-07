import { useMemo } from 'react'

// Форматы храним «книжной» стороной: ширина меньше высоты.
// Альбомная ориентация — тот же формат, положенный набок.
export const FORMATS = [
  { key: 'a6', label: 'A6', w: 105, h: 148 },
  { key: 'a5', label: 'A5', w: 148, h: 210 },
  { key: 'a4', label: 'A4', w: 210, h: 297 },
  { key: 'square', label: 'Квадрат', w: 200, h: 200 },
  { key: 'custom', label: 'Свой', w: 150, h: 200 },
]

const norm = (size) =>
  size.w <= size.h ? { w: size.w, h: size.h } : { w: size.h, h: size.w }

// Какой пресет соответствует размеру: если ни один — это «свой».
export function presetOf(size) {
  const p = norm(size)
  return (
    FORMATS.find((f) => f.key !== 'custom' && f.w === p.w && f.h === p.h)?.key ?? 'custom'
  )
}

/*
 * Выбор формата: пресет, ориентация и свои миллиметры. Компонент не помнит
 * ничего сам — размер приходит и уходит целиком, поэтому его одинаково легко
 * использовать и при создании скетчбука, и при правке готового.
 */
export default function FormatPicker({ size, onChange, disabled, note }) {
  const preset = useMemo(() => presetOf(size), [size])
  const landscape = size.w > size.h
  const square = size.w === size.h

  const apply = (base, land) => {
    const p = norm(base)
    onChange(land && !square ? { w: p.h, h: p.w } : p)
  }

  return (
    <>
      <div className="field">
        <span>Формат</span>
        <div className="chips">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={'chip' + (preset === f.key ? ' chip-on' : '')}
              disabled={disabled}
              onClick={() => apply(f.key === 'custom' ? norm(size) : f, landscape)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="field row">
          <label className="mm">
            <span>Ширина, мм</span>
            <input
              type="number"
              min="20"
              max="1000"
              disabled={disabled}
              value={size.w}
              onChange={(e) => onChange({ ...size, w: Number(e.target.value) })}
            />
          </label>
          <label className="mm">
            <span>Высота, мм</span>
            <input
              type="number"
              min="20"
              max="1000"
              disabled={disabled}
              value={size.h}
              onChange={(e) => onChange({ ...size, h: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      <div className="field">
        <span>Ориентация</span>
        <div className="chips">
          <button
            type="button"
            className={'chip' + (!landscape ? ' chip-on' : '')}
            disabled={disabled || square}
            onClick={() => apply(size, false)}
          >
            Книжная
          </button>
          <button
            type="button"
            className={'chip' + (landscape ? ' chip-on' : '')}
            disabled={disabled || square}
            onClick={() => apply(size, true)}
          >
            Альбомная
          </button>
          {square && <span className="muted small">у квадрата её нет</span>}
        </div>
      </div>

      {note && <p className="muted small">{note}</p>}
    </>
  )
}
