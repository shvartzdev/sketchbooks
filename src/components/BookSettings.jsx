import { useEffect, useRef, useState } from 'react'
import { bookHasImages, uid } from '../lib/db.js'
import FormatPicker from './FormatPicker.jsx'
import BookCover from './BookCover.jsx'
import { normalizeYears } from '../lib/years.js'
import { prepareScan } from '../lib/images.js'

/*
 * Правка готового скетчбука: название, годы и обложка меняются всегда,
 * формат — пока в книжке нет ни одного изображения. Причина простая: положение картинок хранится
 * долями страницы, и смена пропорций сдвинула бы уже собранные развороты.
 */
export default function BookSettings({ book, onCancel, onSave, onDelete }) {
  const [title, setTitle] = useState(book.title)
  const [size, setSize] = useState({ w: book.widthMm, h: book.heightMm })
  const [year, setYear] = useState(book.year ? String(book.year) : '')
  const [locked, setLocked] = useState(null) // null — ещё проверяем
  // обложка: снимок с миниатюрой или null — тогда она рисуется из цвета
  const [cover, setCover] = useState(() =>
    book.cover ? { blob: book.cover, thumb: book.coverThumb, id: book.coverId } : null,
  )
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverError, setCoverError] = useState(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    inputRef.current?.select()
    const onKey = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  useEffect(() => {
    bookHasImages(book.id).then(setLocked)
  }, [book.id])

  const pickCover = async (file) => {
    if (!file) return
    setCoverBusy(true)
    setCoverError(null)
    try {
      const prepared = await prepareScan(file)
      if (!prepared) throw new Error('это не картинка')
      setCover({ blob: prepared.blob, thumb: prepared.thumb, id: uid() })
    } catch (err) {
      setCoverError(`Не получилось прочитать файл: ${err.message}`)
    } finally {
      setCoverBusy(false)
    }
  }

  const valid = size.w >= 20 && size.h >= 20 && size.w <= 1000 && size.h <= 1000

  const submit = (e) => {
    e.preventDefault()
    if (!valid) return
    onSave({
      title: title.trim() || 'Без названия',
      widthMm: Math.round(size.w),
      heightMm: Math.round(size.h),
      year: normalizeYears(year),
      cover: cover?.blob ?? null,
      coverThumb: cover?.thumb ?? null,
      coverId: cover?.id ?? null,
    })
  }

  const previewMax = 120
  const scale = previewMax / Math.max(size.w, size.h)

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="dialog" onSubmit={submit}>
        <h2>Скетчбук</h2>

        <label className="field">
          <span>Название</span>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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

        <FormatPicker
          size={size}
          onChange={setSize}
          disabled={locked !== false}
          note={
            locked === true
              ? 'Формат уже не поменять: в скетчбуке есть изображения, и они размещены относительно страницы. Уберите их — и формат снова станет доступен.'
              : locked === false
                ? 'Изображений пока нет, формат можно менять свободно.'
                : 'Смотрим, есть ли изображения…'
          }
        />

        <div className="preview">
          <div
            className="preview-book"
            style={{
              width: Math.max(24, Math.round(size.w * scale)),
              height: Math.max(24, Math.round(size.h * scale)),
              background: book.coverColor,
            }}
          >
            <BookCover book={{ ...book, title: title.trim() || 'Без названия', year: normalizeYears(year) }} image={cover?.blob} />
          </div>
          <div className="cover-actions">
            <button type="button" className="btn" disabled={coverBusy} onClick={() => fileRef.current?.click()}>
              {coverBusy ? 'Читаем…' : cover ? 'Заменить обложку' : 'Загрузить обложку'}
            </button>
            {cover && (
              <button type="button" className="link-btn small" onClick={() => setCover(null)}>
                убрать — будет цвет с названием
              </button>
            )}
            {coverError && <span className="small danger-text">{coverError}</span>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              hidden
              onChange={(e) => {
                pickCover(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="dialog-actions">
          {/* удаление живёт здесь же: отдельной кнопки на полке нет,
              чтобы не тыкать в неё случайно */}
          <button type="button" className="link-btn small danger delete-book" onClick={onDelete}>
            Удалить скетчбук
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  )
}
