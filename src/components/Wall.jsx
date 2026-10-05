import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadArtwork, loadBook, loadShelf } from '../lib/library.js'
import { blobUrl } from '../lib/images.js'
import { VIEWER } from '../lib/mode.js'

/*
 * Второй экран: все работы разом, одним полем.
 *
 * Не лента и не сетка со страницами, а плоскость, по которой ездят во все
 * стороны: тянешь — она едет за рукой и останавливается по инерции, у краёв
 * мягко пружинит. Порядок — тот, в котором работы добавлялись.
 *
 * Кадры крупные: на таком поле важно узнавать рисунок, а не угадывать его.
 */

const SIZES = [180, 300, 460] // высота ряда: мелко, обычно, крупно
const GAP = 14
const FRICTION = 0.93 // насколько гаснет движение за кадр
const SPRING = 0.12 // с какой силой край возвращает поле назад
const ALBUM = 'dune-albom' // альбом чужих обложек: по умолчанию не показываем

export default function Wall({ onBack, onOpenBook }) {
  const [tiles, setTiles] = useState(null)
  const [rowH, setRowH] = useState(SIZES[1])
  const [withAlbum, setWithAlbum] = useState(false)
  const [hover, setHover] = useState(null)
  const [zoom, setZoom] = useState(null) // работа, открытая крупно
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [, setFrame] = useState(0) // пересчёт видимых кадров

  const stageRef = useRef(null)
  const fieldRef = useRef(null)
  const pos = useRef({ x: 0, y: 0 })
  const vel = useRef({ x: 0, y: 0 })
  const raf = useRef(0)
  const drag = useRef(null)
  const lastCull = useRef({ x: 0, y: 0 })

  /* ---------- что показываем ---------- */

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { books } = await loadShelf()
      const out = []
      for (const book of books) {
        if (!withAlbum && book.slug === ALBUM) continue
        const { pages } = await loadBook(book.id)
        pages.forEach((page, pageIndex) => {
          for (const it of page.items || []) {
            if (it.kind === 'text' || !(it.blob || it.thumb)) continue
            out.push({
              id: `${book.id}-${it.id}`,
              // в мастерской миниатюра крупная (480 px) и её хватает,
              // на витрине миниатюра мелкая — там берём копию для экрана
              src: VIEWER ? it.blob || it.thumb : it.thumb || it.blob,
              full: it.blob,
              aspect: (it.iw && it.ih ? it.iw / it.ih : 0.72) || 0.72,
              book: book.title,
              bookId: book.id,
              page: pageIndex + 1,
            })
          }
        })
      }
      const art = await loadArtwork()
      for (const a of art) {
        out.push({
          id: `art-${a.name}`,
          src: a.url,
          full: a.url,
          aspect: a.aspect || 0.75,
          book: 'Работы на стене',
          bookId: null,
          page: null,
        })
      }
      if (alive) setTiles(out)
    })()
    return () => {
      alive = false
    }
  }, [withAlbum])

  /* ---------- раскладка поля ---------- */

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tiles])

  /*
   * Раскладка: ряды одинаковой высоты, в каждом кадры подогнаны по ширине —
   * как на контактном отпечатке. Ширину поля берём такой, чтобы оно вышло
   * примерно квадратным: тогда ездить во все стороны одинаково удобно.
   */
  const layout = useMemo(() => {
    if (!tiles?.length) return { items: [], w: 0, h: 0 }
    const total = tiles.reduce((sum, t) => sum + rowH * t.aspect + GAP, 0)
    const rows = Math.max(1, Math.round(Math.sqrt(total / (rowH + GAP))))
    const fieldW = Math.max(box.w || 800, total / rows)

    const items = []
    let row = []
    let rowW = 0
    let y = 0
    const flush = (last) => {
      if (!row.length) return
      const scale = last ? 1 : (fieldW - GAP * (row.length - 1)) / (rowW - GAP * (row.length - 1))
      const h = rowH * (last ? 1 : Math.min(scale, 1.6))
      let x = 0
      for (const t of row) {
        const w = h * t.aspect
        items.push({ ...t, x, y, w, h })
        x += w + GAP
      }
      y += h + GAP
      row = []
      rowW = 0
    }
    for (const t of tiles) {
      const w = rowH * t.aspect
      row.push(t)
      rowW += w + GAP
      if (rowW >= fieldW) flush(false)
    }
    flush(true)
    const w = Math.max(...items.map((i) => i.x + i.w), fieldW)
    return { items, w, h: y }
  }, [tiles, box.w, rowH])

  // начальное положение: верхний левый угол поля с небольшим отступом
  useEffect(() => {
    pos.current = { x: 40, y: 40 }
    if (fieldRef.current) {
      fieldRef.current.style.transform = `translate3d(40px, 40px, 0)`
    }
    setFrame((n) => n + 1)
  }, [layout])

  /* ---------- физика ---------- */

  const bounds = useCallback(() => {
    const pad = 120
    return {
      minX: Math.min(pad, box.w - layout.w - pad),
      maxX: pad,
      minY: Math.min(pad, box.h - layout.h - pad),
      maxY: pad,
    }
  }, [box, layout])

  const apply = useCallback(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.transform = `translate3d(${pos.current.x.toFixed(1)}px, ${pos.current.y.toFixed(1)}px, 0)`
    // перерисовываем список видимых кадров не каждый кадр, а когда уехали заметно
    if (
      Math.abs(pos.current.x - lastCull.current.x) > 160 ||
      Math.abs(pos.current.y - lastCull.current.y) > 160
    ) {
      lastCull.current = { ...pos.current }
      setFrame((n) => n + 1)
    }
  }, [])

  const glide = useCallback(() => {
    const b = bounds()
    const out = { x: 0, y: 0 }
    if (pos.current.x > b.maxX) out.x = b.maxX - pos.current.x
    if (pos.current.x < b.minX) out.x = b.minX - pos.current.x
    if (pos.current.y > b.maxY) out.y = b.maxY - pos.current.y
    if (pos.current.y < b.minY) out.y = b.minY - pos.current.y

    pos.current.x += vel.current.x + out.x * SPRING
    pos.current.y += vel.current.y + out.y * SPRING
    vel.current.x *= FRICTION
    vel.current.y *= FRICTION
    apply()

    const moving =
      Math.abs(vel.current.x) > 0.05 ||
      Math.abs(vel.current.y) > 0.05 ||
      Math.abs(out.x) > 0.5 ||
      Math.abs(out.y) > 0.5
    if (moving) raf.current = requestAnimationFrame(glide)
    else {
      raf.current = 0
      lastCull.current = { ...pos.current }
      setFrame((n) => n + 1)
    }
  }, [apply, bounds])

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
  }

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return
    stop()
    vel.current = { x: 0, y: 0 }
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: pos.current.x,
      startY: pos.current.y,
      moved: false,
      last: performance.now(),
    }
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // без захвата жест всё равно доживёт до отпускания
    }
  }

  const onPointerMove = (e) => {
    const g = drag.current
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
    g.moved = true
    const now = performance.now()
    const dt = Math.max(8, now - g.last)
    const nx = g.startX + dx
    const ny = g.startY + dy
    vel.current = {
      x: (nx - pos.current.x) * (16 / dt) * 0.6 + vel.current.x * 0.4,
      y: (ny - pos.current.y) * (16 / dt) * 0.6 + vel.current.y * 0.4,
    }
    pos.current = { x: nx, y: ny }
    g.last = now
    apply()
  }

  const endDrag = () => {
    const g = drag.current
    drag.current = null
    if (g?.moved) raf.current = requestAnimationFrame(glide)
  }

  const onWheel = useCallback(
    (e) => {
      e.preventDefault()
      stop()
      pos.current = { x: pos.current.x - e.deltaX, y: pos.current.y - e.deltaY }
      vel.current = { x: -e.deltaX * 0.25, y: -e.deltaY * 0.25 }
      apply() // сразу, не дожидаясь кадра анимации
      raf.current = requestAnimationFrame(glide)
    },
    [apply, glide],
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  useEffect(() => () => stop(), [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') (zoom ? setZoom(null) : onBack())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, zoom])

  /* ---------- что сейчас видно ---------- */

  const visible = useMemo(() => {
    const margin = 500
    const x = -pos.current.x
    const y = -pos.current.y
    return layout.items.filter(
      (t) =>
        t.x + t.w > x - margin &&
        t.x < x + box.w + margin &&
        t.y + t.h > y - margin &&
        t.y < y + box.h + margin,
    )
    // пересчёт привязан к setFrame: поле уехало — список обновился
  }, [layout, box, tiles, pos.current.x, pos.current.y]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wall-screen">
      <header className="topbar">
        <button className="link-btn" onClick={onBack}>
          ← Полка
        </button>
        <h1>Все работы</h1>
        <div className="topbar-right">
          <span className="counter">{tiles ? `${tiles.length} работ` : 'собираем…'}</span>
          <button
            className="btn"
            onClick={() => setRowH((cur) => SIZES[Math.max(0, SIZES.indexOf(cur) - 1)])}
            disabled={rowH === SIZES[0]}
            title="Мельче"
          >
            −
          </button>
          <button
            className="btn"
            onClick={() => setRowH((cur) => SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(cur) + 1)])}
            disabled={rowH === SIZES[SIZES.length - 1]}
            title="Крупнее"
          >
            +
          </button>
          <button className="btn" onClick={() => setWithAlbum((v) => !v)}>
            {withAlbum ? 'Без альбома' : 'С альбомом'}
          </button>
        </div>
      </header>

      <div
        className="wall-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="wall-field" ref={fieldRef} style={{ width: layout.w, height: layout.h }}>
          {visible.map((t) => (
            <button
              key={t.id}
              className="wall-tile"
              style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
              onMouseEnter={() => setHover(t)}
              onMouseLeave={() => setHover((h) => (h?.id === t.id ? null : h))}
              onClick={() => !drag.current?.moved && setZoom(t)}
            >
              <img src={blobUrl(t.src)} alt="" draggable={false} decoding="async" />
            </button>
          ))}
        </div>

        {tiles && !tiles.length && (
          <p className="muted center wall-empty">Работ пока нет — добавьте страницы в книжки.</p>
        )}
      </div>

      {hover && (
        <div className="wall-label">
          {hover.book}
          {hover.page ? ` · страница ${hover.page}` : ''}
        </div>
      )}

      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)}>
          <img className="wall-zoom-img" src={blobUrl(zoom.full || zoom.src)} alt="" />
          <div className="zoom-bar" onClick={(e) => e.stopPropagation()}>
            <span className="counter">
              {zoom.book}
              {zoom.page ? ` · страница ${zoom.page}` : ''}
            </span>
            {zoom.bookId && (
              <button className="btn" onClick={() => onOpenBook(zoom.bookId)}>
                Открыть книжку
              </button>
            )}
            <button className="btn" onClick={() => setZoom(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
