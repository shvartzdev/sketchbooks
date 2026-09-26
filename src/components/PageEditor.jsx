import { useCallback, useEffect, useRef, useState } from 'react'
import { blobUrl } from '../lib/images.js'
import { clampCrop, fitCrop, getCrop, imageAspect, zoomCrop } from '../lib/crop.js'
import { angleTo, normalizeAngle, toLocalDelta, toPageDelta } from '../lib/geometry.js'
import ItemView from './ItemView.jsx'
import { TextBlock } from './PageContent.jsx'
import { uid } from '../lib/db.js'

/*
 * Крупный просмотр страницы, он же сборка коллажа.
 *
 * Обычный режим: картинку таскают за неё саму, углы меняют размер с сохранением
 * пропорций.
 * Режим кадрирования (двойной клик или кнопка): рамка остаётся на месте, а
 * изображение ездит внутри неё; колесо — масштаб, углы свободно меняют форму
 * рамки, и картинка подстраивается под неё как под окно.
 * Поворот: ручка над картинкой, Shift держит шаг в 15°.
 */

const MIN_SIZE = 0.05
const CORNERS = ['nw', 'ne', 'sw', 'se']

// Подпись: размер шрифта — доля высоты страницы, поэтому она одинаково
// смотрится и в развороте, и в ленте миниатюр, и в PDF.
const TEXT_SIZES = { min: 0.02, max: 0.22, step: 0.005 }
const INKS = ['#2a241c', '#000000', '#7b4b3a', '#8a7a52', '#f4f1ea']
const isText = (it) => it?.kind === 'text'

export default function PageEditor({
  page,
  number,
  total,
  aspect,
  canPrev,
  canNext,
  onMove,
  onClose,
  onChange,
  onAddImage,
  busy,
}) {
  const [items, setItems] = useState(page.items || [])
  const [selected, setSelected] = useState(null)
  const [cropping, setCropping] = useState(null) // id картинки в режиме кадрирования
  const [editing, setEditing] = useState(null) // id подписи, которую сейчас набирают
  const [pageBox, setPageBox] = useState({ w: 0, h: 0 }) // размер страницы на экране
  const pageRef = useRef(null)
  const gesture = useRef(null)
  const itemsRef = useRef(items)
  const natural = useRef(new Map()) // пропорции исходников, если их нет в данных
  const lastSent = useRef(null) // что мы сами только что отдали наверх
  itemsRef.current = items

  // Страница приходит сверху и после каждого нашего же сохранения возвращается
  // новым объектом. Свои изменения узнаём по ссылке на массив и пропускаем:
  // иначе сохранение сбрасывало бы и выделение, и режим кадрирования —
  // приблизил кадр и тут же из него вылетел.
  useEffect(() => {
    const next = page.items || []
    if (next === lastSent.current) return
    setItems(next)
    itemsRef.current = next
    // сразу выделяем верхнюю картинку: иначе кнопки открываются серыми и
    // выглядят сломанными, пока не догадаешься ткнуть в саму картинку
    setSelected(next.length ? next[next.length - 1].id : null)
    setCropping(null)
  }, [page.id, page.items])

  // Кегль подписи задан долей высоты страницы, поэтому нужен её размер на экране.
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setPageBox({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const aspectOf = useCallback((item) => imageAspect(item, natural.current.get(item.id) || 1), [])

  /*
   * Во время жеста истина живёт в itemsRef, а не в состоянии React: между
   * последним движением и отпусканием кнопки ре-рендера может не случиться,
   * и сохранение забирало бы устаревшие значения — правка «не прилипала».
   */
  const save = useCallback(
    (next) => {
      lastSent.current = next
      onChange(page.id, next)
    },
    [onChange, page.id],
  )

  const commit = useCallback(
    (next) => {
      itemsRef.current = next
      setItems(next)
      save(next)
    },
    [save],
  )

  const patchItem = useCallback((id, patch) => {
    const next = itemsRef.current.map((i) => (i.id === id ? { ...i, ...patch } : i))
    itemsRef.current = next
    setItems(next)
  }, [])

  /* ---------- жесты ---------- */

  const onPointerDown = (e, id, corner) => {
    e.stopPropagation()
    const item = itemsRef.current.find((i) => i.id === id)
    if (!item) return
    setSelected(id)
    const rect = pageRef.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    gesture.current = {
      id,
      corner,
      mode:
        corner === 'rotate'
          ? 'rotate'
          : corner
            ? 'resize'
            : cropping === id
              ? 'pan'
              : 'move',
      // угол, под которым схватили ручку: крутим относительно него,
      // иначе картинка прыгает в момент нажатия
      grabAngle: angleTo(item.x + item.w / 2, item.y + item.h / 2, px, py, aspect),
      pointerId: e.pointerId,
      rect,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...item },
      startCrop: getCrop(item),
      ratio: item.w / item.h,
      // подпись и кадрирование тянутся свободно, картинка — с сохранением пропорций
      free: cropping === id || isText(item),
      moved: false,
    }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // без захвата жест тоже доживёт до pointerup, просто менее цепко
    }
  }

  const onPointerMove = (e) => {
    const g = gesture.current
    if (!g || g.pointerId !== e.pointerId) return
    if (!g.moved && Math.abs(e.clientX - g.startX) < 2 && Math.abs(e.clientY - g.startY) < 2) return
    g.moved = true

    const dx = (e.clientX - g.startX) / g.rect.width
    const dy = (e.clientY - g.startY) / g.rect.height
    const s = g.start
    const imgAspect = aspectOf(s)

    if (g.mode === 'move') {
      // центр картинки не выпускаем за пределы страницы
      patchItem(g.id, {
        x: Math.min(1 - s.w / 2, Math.max(-s.w / 2, s.x + dx)),
        y: Math.min(1 - s.h / 2, Math.max(-s.h / 2, s.y + dy)),
      })
      return
    }

    if (g.mode === 'rotate') {
      const px = (e.clientX - g.rect.left) / g.rect.width
      const py = (e.clientY - g.rect.top) / g.rect.height
      const now = angleTo(s.x + s.w / 2, s.y + s.h / 2, px, py, aspect)
      let angle = (s.rot || 0) + (now - g.grabAngle)
      if (e.shiftKey) angle = Math.round(angle / 15) * 15
      patchItem(g.id, { rot: Math.round(normalizeAngle(angle) * 10) / 10 })
      return
    }

    if (g.mode === 'pan') {
      // тянем изображение внутри неподвижной рамки
      const c = g.startCrop
      const local = toLocalDelta(dx, dy, s.rot, aspect)
      patchItem(g.id, {
        crop: clampCrop(
          { ...c, x: c.x - (local.dx / s.w) * c.w, y: c.y - (local.dy / s.h) * c.h },
          s,
          aspect,
          imgAspect,
        ),
      })
      return
    }

    // resize: противоположный угол стоит на месте.
    // Ведение переводим в систему координат картинки — иначе у повёрнутой
    // рамки углы тянулись бы вбок.
    const east = g.corner.includes('e')
    const south = g.corner.includes('s')
    const local = toLocalDelta(dx, dy, s.rot, aspect)
    const rawW = east ? s.w + local.dx : s.w - local.dx
    const rawH = south ? s.h + local.dy : s.h - local.dy

    let w
    let h
    if (g.free) {
      w = Math.max(MIN_SIZE, rawW)
      h = Math.max(MIN_SIZE, rawH)
    } else {
      // пропорции целы: ведём по той стороне, которая ушла дальше
      w = Math.max(MIN_SIZE, Math.abs(rawW) > Math.abs(rawH * g.ratio) ? rawW : rawH * g.ratio)
      h = Math.max(MIN_SIZE, w / g.ratio)
    }
    // центр уезжает на половину прироста — в системе картинки, потом обратно
    const grow = toPageDelta(
      ((east ? 1 : -1) * (w - s.w)) / 2,
      ((south ? 1 : -1) * (h - s.h)) / 2,
      s.rot,
      aspect,
    )
    const cx = s.x + s.w / 2 + grow.dx
    const cy = s.y + s.h / 2 + grow.dy
    const frame = { ...s, w, h, x: cx - w / 2, y: cy - h / 2 }
    patchItem(g.id, isText(s) ? frame : { ...frame, crop: clampCrop(g.startCrop, frame, aspect, imgAspect) })
  }

  const endGesture = () => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    if (g.moved) save(itemsRef.current)
  }

  /* ---------- операции ---------- */

  const item = items.find((i) => i.id === selected)

  const zoom = useCallback(
    (k) => {
      const it = itemsRef.current.find((i) => i.id === cropping)
      if (!it) return
      commit(
        itemsRef.current.map((i) =>
          i.id === it.id ? { ...i, crop: zoomCrop(getCrop(it), k, it, aspect, aspectOf(it)) } : i,
        ),
      )
    },
    [aspect, aspectOf, commit, cropping],
  )

  const resetCrop = () => {
    const it = itemsRef.current.find((i) => i.id === cropping)
    if (!it) return
    commit(
      itemsRef.current.map((i) =>
        i.id === it.id ? { ...i, crop: fitCrop(it, aspect, aspectOf(it)) } : i,
      ),
    )
  }

  const patchSelected = (patch) => {
    if (!selected) return
    commit(itemsRef.current.map((i) => (i.id === selected ? { ...i, ...patch } : i)))
  }

  const addText = () => {
    const it = {
      id: uid(),
      kind: 'text',
      text: 'Текст',
      x: 0.12,
      y: 0.44,
      w: 0.76,
      h: 0.12,
      rot: 0,
      size: 0.05,
      align: 'center',
      color: INKS[0],
      font: 'serif',
      weight: 400,
    }
    commit([...itemsRef.current, it])
    setSelected(it.id)
    setCropping(null)
    setEditing(it.id)
  }

  const resizeText = (dir) => {
    const it = itemsRef.current.find((i) => i.id === selected)
    if (!isText(it)) return
    const size = Math.min(TEXT_SIZES.max, Math.max(TEXT_SIZES.min, (it.size ?? 0.05) + dir * TEXT_SIZES.step))
    patchSelected({ size: Math.round(size * 1000) / 1000 })
  }

  const removeSelected = useCallback(() => {
    if (!selected) return
    commit(itemsRef.current.filter((i) => i.id !== selected))
    setSelected(null)
    setCropping(null)
  }, [commit, selected])

  const rotateBy = (deg) => {
    if (!selected) return
    commit(
      itemsRef.current.map((i) =>
        i.id === selected ? { ...i, rot: normalizeAngle((i.rot || 0) + deg) } : i,
      ),
    )
  }

  const bringToFront = () => {
    if (!selected) return
    const it = itemsRef.current.find((i) => i.id === selected)
    commit([...itemsRef.current.filter((i) => i.id !== selected), it])
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return
      if (e.key === 'Escape') {
        if (editing) setEditing(null)
        else if (cropping) setCropping(null)
        else onClose()
      } else if (e.key === 'Backspace' || e.key === 'Delete') removeSelected()
      else if (e.key === 'ArrowRight' && !cropping) onMove(1)
      else if (e.key === 'ArrowLeft' && !cropping) onMove(-1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cropping, editing, onClose, onMove, removeSelected])

  // колесо масштабирует кадр — только когда кадрируем, иначе это просто скролл
  const onWheel = (e) => {
    if (!cropping) return
    e.preventDefault()
    zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08)
  }

  return (
    <div className="editor" onPointerDown={onClose}>
      <div className="editor-inner" onPointerDown={(e) => e.stopPropagation()}>
        <div
          className={'editor-page' + (cropping ? ' editor-page-crop' : '')}
          ref={pageRef}
          style={{ aspectRatio: String(aspect) }}
          onPointerDown={() => {
            setSelected(null)
            setCropping(null)
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onWheel={onWheel}
        >
          {page.blob && (
            <img className="page-scan" src={blobUrl(page.blob)} alt="" draggable={false} />
          )}

          {items.map((it) => (
            <div
              key={it.id}
              className={
                'edit-item' +
                (selected === it.id ? ' edit-item-on' : '') +
                (cropping === it.id ? ' edit-item-crop' : '')
              }
              style={{
                left: `${it.x * 100}%`,
                top: `${it.y * 100}%`,
                width: `${it.w * 100}%`,
                height: `${it.h * 100}%`,
                transform: it.rot ? `rotate(${it.rot}deg)` : undefined,
              }}
              onPointerDown={(e) => onPointerDown(e, it.id, null)}
              onDoubleClick={() =>
                isText(it)
                  ? setEditing(it.id)
                  : setCropping(cropping === it.id ? null : it.id)
              }
            >
              {/* обрезка живёт во внутреннем слое: иначе overflow рамки
                  срезал бы ручки, которые торчат наружу */}
              <div className="edit-clip">
                {isText(it) ? (
                  editing === it.id ? (
                    <textarea
                      className={'edit-text page-text-' + (it.font || 'serif')}
                      value={it.text}
                      autoFocus
                      style={{
                        fontSize: `${(it.size ?? 0.05) * pageBox.h}px`,
                        textAlign: it.align || 'center',
                        color: it.color,
                        fontWeight: it.weight || 400,
                      }}
                      onChange={(e) => patchItem(it.id, { text: e.target.value })}
                      onBlur={() => {
                        setEditing(null)
                        save(itemsRef.current)
                      }}
                      onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <TextBlock item={it} fontSize={(it.size ?? 0.05) * pageBox.h} />
                  )
                ) : (
                  <ItemView
                    item={it}
                    onLoad={(e) => {
                      const img = e.currentTarget
                      if (img.naturalWidth) {
                        natural.current.set(it.id, img.naturalWidth / img.naturalHeight)
                      }
                    }}
                  />
                )}
              </div>
              {selected === it.id && (
                <>
                  {CORNERS.map((c) => (
                    <span
                      key={c}
                      className={'handle handle-' + c}
                      onPointerDown={(e) => onPointerDown(e, it.id, c)}
                    />
                  ))}
                  <span
                    className="handle handle-rotate"
                    title="Повернуть (Shift — по 15°)"
                    onPointerDown={(e) => onPointerDown(e, it.id, 'rotate')}
                  />
                </>
              )}
            </div>
          ))}

          {items.length === 0 && !page.blob && (
            <p className="editor-hint muted">
              Пустая страница. Добавьте изображение или подпись — их можно двигать, тянуть за
              углы и поворачивать.
            </p>
          )}

          <span className="page-number page-number-right">{number}</span>
        </div>

        {cropping ? (
          <div className="editor-bar">
            <span className="muted small">
              Тяните картинку внутри рамки, углы меняют форму кадра
            </span>
            <span className="editor-sep" />
            <button className="btn" onClick={() => zoom(1 / 1.15)}>
              −
            </button>
            <button className="btn" onClick={() => zoom(1.15)}>
              +
            </button>
            <button className="btn" onClick={resetCrop}>
              Весь снимок
            </button>
            <button className="btn btn-primary" onClick={() => setCropping(null)}>
              Готово
            </button>
          </div>
        ) : (
          <div className="editor-bar">
            <button className="btn" onClick={() => onMove(-1)} disabled={!canPrev}>
              ←
            </button>
            <span className="counter">
              {number} / {total}
            </span>
            <button className="btn" onClick={() => onMove(1)} disabled={!canNext}>
              →
            </button>

            <span className="editor-sep" />

            <label className={'btn btn-primary' + (busy ? ' btn-busy' : '')}>
              {busy ? 'Готовим…' : 'Добавить изображение'}
              <input
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                hidden
                onChange={(e) => {
                  onAddImage(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
            <button className="btn" onClick={addText}>
              Текст
            </button>

            <span className="editor-sep" />

            {isText(item) ? (
              <>
                <button className="btn" onClick={() => resizeText(-1)} title="Мельче">
                  А−
                </button>
                <button className="btn" onClick={() => resizeText(1)} title="Крупнее">
                  А+
                </button>
                <button
                  className={'btn' + (item.font !== 'sans' ? ' btn-on' : '')}
                  onClick={() => patchSelected({ font: item.font === 'sans' ? 'serif' : 'sans' })}
                  title="Шрифт: с засечками или без"
                >
                  {item.font === 'sans' ? 'Гротеск' : 'Антиква'}
                </button>
                <button
                  className={'btn' + ((item.weight || 400) >= 600 ? ' btn-on' : '')}
                  onClick={() => patchSelected({ weight: (item.weight || 400) >= 600 ? 400 : 600 })}
                  title="Полужирный"
                >
                  <b>Ж</b>
                </button>
                {[
                  ['left', '⟵', 'По левому краю'],
                  ['center', '⟷', 'По центру'],
                  ['right', '⟶', 'По правому краю'],
                ].map(([value, sign, hint]) => (
                  <button
                    key={value}
                    className={'btn' + ((item.align || 'center') === value ? ' btn-on' : '')}
                    onClick={() => patchSelected({ align: value })}
                    title={hint}
                  >
                    {sign}
                  </button>
                ))}
                <span className="ink-row">
                  {INKS.map((c) => (
                    <button
                      key={c}
                      className={'ink' + (item.color === c ? ' ink-on' : '')}
                      style={{ background: c }}
                      onClick={() => patchSelected({ color: c })}
                      title="Цвет подписи"
                    />
                  ))}
                </span>
                <button
                  className="btn"
                  onClick={() => patchSelected({ x: (1 - item.w) / 2 })}
                  title="Поставить блок по центру страницы по горизонтали"
                >
                  ↔ по центру
                </button>
                <button
                  className="btn"
                  onClick={() => patchSelected({ y: (1 - item.h) / 2 })}
                  title="Поставить блок по центру страницы по вертикали"
                >
                  ↕ по центру
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setCropping(selected)} disabled={!item}>
                Кадрировать
              </button>
            )}
            <button className="btn" onClick={() => rotateBy(-90)} disabled={!item} title="Повернуть влево">
              ⟲
            </button>
            <button className="btn" onClick={() => rotateBy(90)} disabled={!item} title="Повернуть вправо">
              ⟳
            </button>
            <button className="btn" onClick={bringToFront} disabled={!item}>
              На передний план
            </button>
            <button className="btn btn-danger" onClick={removeSelected} disabled={!item}>
              Убрать
            </button>

            <span className="editor-sep" />

            <button className="btn" onClick={onClose}>
              Готово
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
