import { useEffect, useRef, useState } from 'react'
import FormatPicker from './FormatPicker.jsx'
import { normalizeYears } from '../lib/years.js'

const COVERS = ['#2f3640', '#7b4b3a', '#3d5a4c', '#4a4066', '#8a7a52', '#1f2933']

export default function NewBookDialog({ onCancel, onCreate }) {
  const [title, setTitle] = useState('')
  const [size, setSize] = useState({ w: 148, h: 210 })
  const [year, setYear] = useState('')
  const [cover, setCover] = useState(COVERS[0])
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const valid = size.w >= 20 && size.h >= 20 && size.w <= 1000 && size.h <= 1000

  const submit = (e) => {
    e.preventDefault()
    if (!valid) return
    onCreate({
      title: title.trim() || 'Без названия',
      widthMm: Math.round(size.w),
      heightMm: Math.round(size.h),
      coverColor: cover,
      year: normalizeYears(year),
    })
  }

  // превью в тех же пропорциях, что и будущая книжка
  const scale = 150 / Math.max(size.w, size.h)

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Новый скетчбук</h2>

        <label className="field">
          <span>Название</span>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например, «Лиссабон, весна»"
            maxLength={80}
          />
        </label>

        <label className="field">
          <span>Год рисунков</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="2024 или 2024–2026"
            maxLength={12}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </label>

        <FormatPicker size={size} onChange={setSize} />

        <div className="field">
          <span>Обложка</span>
          <div className="chips">
            {COVERS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={'Цвет ' + c}
                className={'swatch' + (cover === c ? ' swatch-on' : '')}
                style={{ background: c }}
                onClick={() => setCover(c)}
              />
            ))}
          </div>
        </div>

        <div className="preview">
          <div
            className="preview-book"
            style={{
              width: Math.max(24, Math.round(size.w * scale)),
              height: Math.max(24, Math.round(size.h * scale)),
              background: cover,
            }}
          >
            <span>
              {Math.round(size.w)}×{Math.round(size.h)} мм
            </span>
          </div>
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            Создать
          </button>
        </div>
      </form>
    </div>
  )
}
