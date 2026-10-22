import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { paletteOf } from '../lib/palette.js'
import BookCover from './BookCover.jsx'
import { Painting } from './Decor.jsx'

/*
 * Лента обложек, как в Paper: скетчбуки и за ними работы стоят в один ряд,
 * та, что посередине, — в полный рост, соседи поменьше и приглушены.
 * Клик по соседке подвозит её к середине, клик по средней — открывает.
 *
 * За лентой светится фон из главных цветов средней обложки, размытый до
 * пятен: сменилась обложка — фон перетекает в её краски.
 *
 * Пальцем на телефоне лента едет сама — обычная прокрутка с прилипанием.
 * Тачпад (в любую сторону) и колесо ведут её за жестом, но не дальше
 * соседней обложки; мышью её тянут, стрелки шагают по одной.
 *
 * Места в ленте одинаковые: каждая книжка или рама вписана в одну и ту же
 * клетку. Иначе соседи стоят то ближе, то дальше — смотря кто рядом
 * альбомный, а кто книжный, — и глазу не за что зацепиться.
 */

// Где лента стояла, когда из неё ушли в книжку: по возвращении она там же.
let lastKey = null

const SHRINK = 0.2 // насколько меньше соседки, стоящие вплотную к середине
const DIM = 0.45 // и насколько они бледнее
const BORDER = 0.12 // багет + паспарту — доля короткой стороны рамы

// Клетка ленты: высота — от окна, ширина — пропорция книжного листа, но так,
// чтобы на узком экране по краям выглядывали соседи.
function cellFor() {
  const narrow = window.innerWidth < 760
  const h = Math.round(Math.max(220, Math.min(narrow ? 500 : 560, window.innerHeight * 0.64)))
  const w = Math.round(Math.min(h * 0.76, window.innerWidth * (narrow ? 0.68 : 0.42)))
  return { w, h }
}

// Вписать прямоугольник с пропорцией aspect в клетку.
function fit(aspect, cell) {
  return aspect > cell.w / cell.h
    ? { w: cell.w, h: Math.round(cell.w / aspect) }
    : { w: Math.round(cell.h * aspect), h: cell.h }
}

/*
 * Рама изнутри наружу, как у настоящей: работа своих пропорций, вокруг неё
 * ровное поле паспарту, снаружи багет. Задана внешняя высота — ширина
 * получается сама, и в окне паспарту работа сидит ровно, без пустот.
 */
function frameAround(aspect, outerH) {
  // поле считаем от короткой стороны рамы; у вертикальной работы это ширина,
  // которая сама зависит от поля, — отсюда формула, а не простая доля
  const b =
    aspect >= 1
      ? BORDER * outerH
      : (BORDER * aspect * outerH) / (1 - 2 * BORDER + 2 * BORDER * aspect)
  const frame = Math.max(4, Math.round(b * 0.375))
  const mat = Math.max(5, Math.round(b * 0.625))
  const edge = frame + mat
  const h = Math.round(outerH)
  const w = Math.round((h - 2 * edge) * aspect) + 2 * edge
  return { h, w, frame, mat }
}

// Рама, вписанная в клетку: сначала во всю высоту, а не влезла по ширине —
// ужимаем целиком.
function frameIn(aspect, cell) {
  const tall = frameAround(aspect, cell.h)
  return tall.w <= cell.w ? tall : frameAround(aspect, (cell.h * cell.w) / tall.w)
}

export default function Ribbon({ items, onOpen, onEdit, onMove, disabled = false }) {
  const trackRef = useRef(null)
  const rootRef = useRef(null)
  const cards = useRef([])
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((it) => it.key === lastKey)))
  const activeRef = useRef(active)
  // Куда лента едет сейчас. Пока она в пути, середина ещё старая, и второе
  // нажатие стрелки считало бы шаг от неё — лента сдвигалась бы на одну
  // обложку, сколько ни жми. Поэтому шагаем от цели.
  const targetRef = useRef(null)
  const [cell, setCell] = useState(cellFor)
  const dragged = useRef(0) // когда закончилось последнее перетаскивание мышью
  const glide = useRef(0) // кадр текущего проезда
  const wheel = useRef({ active: false, last: 0, base: 0, peak: 0, level: 0, dir: 0, timer: 0 })
  const watchdog = useRef(0)

  // Масштаб и прозрачность каждой обложки — от её расстояния до середины.
  // Пишем прямо в стили: на каждый кадр прокрутки перерисовывать React незачем.
  const paint = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const box = track.getBoundingClientRect()
    const mid = box.left + box.width / 2
    let best = 0
    let bestD = Infinity
    cards.current.forEach((el, i) => {
      if (!el) return
      const r = el.offsetLeft + el.offsetWidth / 2 - track.scrollLeft + box.left
      const d = Math.abs(r - mid)
      if (d < bestD) {
        bestD = d
        best = i
      }
      const t = Math.min(1, d / (box.width * 0.4))
      el.style.transform = `scale(${1 - SHRINK * t})`
      el.style.opacity = String(1 - DIM * t)
    })
    if (best === targetRef.current) targetRef.current = null
    if (best !== activeRef.current) {
      cards.current[activeRef.current]?.removeAttribute('aria-current')
      cards.current[best]?.setAttribute('aria-current', 'true')
      activeRef.current = best
      setActive(best)
    }
  }, [])

  const stopGlide = useCallback(() => {
    cancelAnimationFrame(glide.current)
    glide.current = 0
  }, [])

  /*
   * Проезд до обложки — свой, а не браузерный scrollTo({behavior:'smooth'}).
   * Браузерный не говорит, когда доехал, а прилипание к обложкам, включённое
   * хоть на кадр раньше, дёргает ленту к ближайшей — отсюда был скачок в
   * конце. Здесь прилипание выключено, пока лента едет, и включается ровно
   * в точке, где она остановилась.
   */
  const centerOn = useCallback(
    (i, smooth = true) => {
      const track = trackRef.current
      const el = cards.current[i]
      if (!track || !el) return
      stopGlide()
      const to = el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2
      const from = track.scrollLeft
      const dist = to - from
      if (!smooth || Math.abs(dist) < 1) {
        targetRef.current = null
        track.scrollLeft = to
        track.classList.remove('strip-free')
        return
      }
      targetRef.current = i
      track.classList.add('strip-free')
      const duration = Math.min(700, 280 + Math.abs(dist) * 0.3)
      const start = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration)
        track.scrollLeft = from + dist * (1 - (1 - t) ** 3) // плавное торможение
        if (t < 1) {
          glide.current = requestAnimationFrame(tick)
        } else {
          glide.current = 0
          track.classList.remove('strip-free')
        }
      }
      glide.current = requestAnimationFrame(tick)
      // Если кадры не идут (вкладка в фоне, окно свёрнуто), лента не должна
      // застрять посреди дороги с выключенным прилипанием: доставляем сразу.
      clearTimeout(watchdog.current)
      watchdog.current = setTimeout(() => {
        if (!glide.current) return
        stopGlide()
        track.scrollLeft = to
        track.classList.remove('strip-free')
      }, duration + 150)
    },
    [stopGlide],
  )

  const step = useCallback(
    (dir) => {
      const from = targetRef.current ?? activeRef.current
      const next = Math.min(items.length - 1, Math.max(0, from + dir))
      if (next !== from) centerOn(next)
    },
    [items.length, centerOn],
  )

  // первая расстановка: сразу на той обложке, с которой ушли, без проезда
  useLayoutEffect(() => {
    centerOn(activeRef.current, false)
    paint()
    cards.current[activeRef.current]?.setAttribute('aria-current', 'true')
    // только при первом показе: дальше лента едет сама
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // работы приезжают позже книжек — новые обложки тоже надо расставить
  useLayoutEffect(paint, [items, paint])

  // окно поменялось — клетки другие, середину ставим заново
  const firstCell = useRef(true)
  useLayoutEffect(() => {
    if (firstCell.current) {
      firstCell.current = false
      return
    }
    centerOn(activeRef.current, false)
    paint()
  }, [cell, centerOn, paint])

  useEffect(() => {
    const track = trackRef.current
    // Браузер и так шлёт scroll не чаще кадра, поэтому рисуем прямо здесь:
    // через requestAnimationFrame подпись и размеры обложек отставали от
    // ленты, если кадры придерживались.
    const onScroll = paint
    const onResize = () => setCell(cellFor())

    /*
     * Свайп двумя пальцами — вбок или вверх-вниз, как прокрутка страницы, —
     * и колесо мыши листают одинаково: лента идёт за пальцами, но за один
     * жест уезжает не дальше соседней обложки, а когда события кончаются,
     * встаёт на обложку.
     *
     * Жест тачпада — поток событий примерно на секунду вместе с инерцией,
     * паузы внутри не длиннее 70 мс (записано на настоящем тачпаде).
     * Новый жест — это пауза дольше 120 мс, смена направления или рывок
     * после того, как инерция затухла: она только слабеет (17 → 2 → 1),
     * а новый свайп сразу даёт десятки. Так второй быстрый свайп
     * срабатывает сразу, а не ждёт, пока кончится хвост первого.
     */
    const centerX = (i) => {
      const el = cards.current[i]
      return el ? el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2 : track.scrollLeft
    }
    const nearest = () => {
      const x = track.scrollLeft
      let best = 0
      cards.current.forEach((el, i) => {
        if (el && Math.abs(centerX(i) - x) < Math.abs(centerX(best) - x)) best = i
      })
      return best
    }
    const settle = () => {
      const w = wheel.current
      w.active = false
      const base = w.base
      const moved = track.scrollLeft - centerX(base)
      const next = cards.current[base + Math.sign(moved)]
      const gap = next ? Math.abs(centerX(base + Math.sign(moved)) - centerX(base)) : Infinity
      // пятой части пути до соседки хватает, чтобы перелистнуть
      centerOn(Math.abs(moved) > gap * 0.2 ? base + Math.sign(moved) : base)
    }
    const onWheel = (e) => {
      e.preventDefault()
      const w = wheel.current
      const now = performance.now()
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      const size = Math.abs(delta)
      const faded = w.peak >= 6 && w.level < w.peak * 0.3
      const fresh =
        !w.active ||
        now - w.last > 120 ||
        (size > 4 && w.dir && Math.sign(delta) !== w.dir) ||
        (faded && size > Math.max(6, w.level * 2.5))
      w.last = now
      if (fresh) {
        stopGlide()
        targetRef.current = null
        track.classList.add('strip-free')
        w.active = true
        w.base = nearest()
        w.peak = 0
        w.dir = 0
      }
      w.peak = Math.max(w.peak, size)
      w.level = size
      if (size > 2) w.dir = Math.sign(delta)
      const lo = centerX(Math.max(0, w.base - 1))
      const hi = centerX(Math.min(items.length - 1, w.base + 1))
      track.scrollLeft = Math.min(hi, Math.max(lo, track.scrollLeft + delta))
      clearTimeout(w.timer)
      w.timer = setTimeout(settle, 130)
    }
    // палец или тачпад перехватили ленту — прежняя цель больше не цель,
    // а начатый проезд останавливаем, чтобы он не спорил с рукой
    const onGrab = () => {
      targetRef.current = null
      if (glide.current) {
        stopGlide()
        track.classList.remove('strip-free')
      }
    }

    /*
     * Мышью ленту тянут, как пальцем: обложки едут за курсором, а на
     * отпускании доезжает до той обложки, где остановилась бы по инерции:
     * резкий бросок уносит дальше, медленное отпускание — к ближайшей.
     * Палец и тачпад этого не требуют — у них своя прокрутка.
     */
    let drag = null
    const onDown = (e) => {
      onGrab()
      if (e.pointerType === 'touch' || e.button !== 0) return
      if (e.target.closest?.('.strip-tools')) return // стрелки и ✎ — не повод тянуть
      drag = { x: e.clientX, left: track.scrollLeft, moved: false, v: 0, t: e.timeStamp, last: e.clientX }
    }
    const onMoveDrag = (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      if (!drag.moved) {
        if (Math.abs(dx) < 5) return
        drag.moved = true
        // прилипание мешало бы вести ленту плавно — на время жеста выключаем
        track.classList.add('strip-free', 'strip-dragging')
      }
      // скорость сглаживаем: одиночное событие мыши бывает рваным
      const dt = Math.max(1, e.timeStamp - drag.t)
      drag.v = drag.v * 0.6 + ((e.clientX - drag.last) / dt) * 0.4
      drag.t = e.timeStamp
      drag.last = e.clientX
      track.scrollLeft = drag.left - dx
    }
    const onUp = () => {
      if (!drag) return
      const g = drag
      drag = null
      if (!g.moved) return
      dragged.current = performance.now()
      track.classList.remove('strip-dragging')
      // куда докатилась бы лента по инерции — к той обложке и едем
      const aim = track.scrollLeft + track.clientWidth / 2 - g.v * 220
      let next = 0
      cards.current.forEach((el, i) => {
        const near = cards.current[next]
        if (el && Math.abs(el.offsetLeft + el.offsetWidth / 2 - aim) < Math.abs(near.offsetLeft + near.offsetWidth / 2 - aim)) next = i
      })
      centerOn(next)
    }

    track.addEventListener('scroll', onScroll, { passive: true })
    // Тянуть можно с любого места экрана, а вести — куда угодно: движение
    // и отпускание слушаем у окна, чтобы жест не терялся, когда курсор
    // съезжает с обложки или с самой ленты.
    const root = rootRef.current
    const noNativeDrag = (e) => e.preventDefault()
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('dragstart', noNativeDrag)
    window.addEventListener('pointermove', onMoveDrag)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    track.addEventListener('touchstart', onGrab, { passive: true })
    root.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onResize)
    return () => {
      stopGlide()
      track.removeEventListener('scroll', onScroll)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('dragstart', noNativeDrag)
      window.removeEventListener('pointermove', onMoveDrag)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      track.removeEventListener('touchstart', onGrab)
      root.removeEventListener('wheel', onWheel)
      clearTimeout(wheel.current.timer)
      window.removeEventListener('resize', onResize)
    }
  }, [paint, centerOn, step, stopGlide, items.length])

  const open = useCallback(
    (i) => {
      const item = items[i]
      const el = cards.current[i]
      if (!item || !el) return
      lastKey = item.key
      onOpen(item, el.querySelector('.strip-face').getBoundingClientRect())
    },
    [items, onOpen],
  )

  useEffect(() => {
    if (disabled) return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
      const i = activeRef.current
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'Enter') open(i)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled, step, open])

  const current = items[active]
  useEffect(() => {
    if (current) lastKey = current.key
  }, [current])

  // Фон меняется, когда лента остановилась на обложке, а не на каждой,
  // мимо которой она проезжает: смена размытого фона — самое дорогое здесь.
  const [lit, setLit] = useState(active)
  useEffect(() => {
    const t = setTimeout(() => setLit(active), 160)
    return () => clearTimeout(t)
  }, [active])
  const litItem = items[lit] ?? current

  // Сами обложки собираются заново только когда поменялся их набор или
  // размер окна — смена средней обложки их не трогает.
  const cardEls = useMemo(
    () =>
      items.map((item, i) => {
        const size = item.kind === 'art' ? frameIn(item.aspect, cell) : fit(item.aspect, cell)
        return (
          <button
            key={item.key}
            ref={(el) => (cards.current[i] = el)}
            className={'strip-card strip-' + item.kind}
            style={{ width: cell.w, height: cell.h }}
            onClick={() => {
              // отпустили после перетаскивания — это не клик по обложке
              if (performance.now() - dragged.current < 250) return
              if (i === activeRef.current) open(i)
              else centerOn(i)
            }}
            aria-label={item.title}
          >
            {item.kind === 'book' ? (
              <span className="strip-face strip-book-face" style={{ width: size.w, height: size.h }}>
                <BookCover book={item.book} image={item.image} />
              </span>
            ) : (
              <span className="strip-face">
                <Painting
                  item={{
                    src: item.image,
                    w: size.w,
                    h: size.h,
                    frame: size.frame,
                    mat: size.mat,
                    dark: true, // в ленте у всех работ чёрное паспарту
                  }}
                />
              </span>
            )}
          </button>
        )
      }),
    [items, cell, open, centerOn],
  )

  return (
    <div className="strip" ref={rootRef}>
      <Glow src={litItem?.thumb} fallback={litItem?.color} />

      <div className="strip-track" ref={trackRef}>
        {cardEls}
      </div>

      {current && (
        <div className="strip-caption" key={current.key}>
          <div className="strip-title">{current.title}</div>
          {current.about && <div className="strip-about">{current.about}</div>}
          {(onEdit || onMove) && (
            <div className="strip-tools">
              {onMove && (
                <button
                  className="link-btn"
                  title="Сдвинуть влево"
                  disabled={!current.canMove?.(-1)}
                  onClick={() => onMove(current, -1)}
                >
                  ←
                </button>
              )}
              {onEdit && current.kind === 'book' && (
                <button className="link-btn" title="Название, формат, удаление" onClick={() => onEdit(current)}>
                  ✎
                </button>
              )}
              {onMove && (
                <button
                  className="link-btn"
                  title="Сдвинуть вправо"
                  disabled={!current.canMove?.(1)}
                  onClick={() => onMove(current, 1)}
                >
                  →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="strip-dots" aria-hidden="true">
        {items.map((item, i) => (
          <span
            key={item.key}
            className={'strip-dot' + (i === active ? ' strip-dot-on' : '') + (item.kind === 'art' ? ' strip-dot-art' : '')}
          />
        ))}
      </div>
    </div>
  )
}

/*
 * Фон: три главных цвета обложки пятнами, размытыми до тумана. Каждый новый
 * фон проявляется поверх прежнего, прежний убирается, когда его уже не видно.
 */
function Glow({ src, fallback }) {
  const [layers, setLayers] = useState([])
  const seq = useRef(0)

  useEffect(() => {
    let alive = true
    paletteOf(src).then((colors) => {
      if (!alive) return
      const c = colors?.length ? colors : fallback ? [fallback] : null
      if (!c) return
      const id = ++seq.current
      setLayers((prev) => [...prev.slice(-1), { id, colors: c }])
    })
    return () => {
      alive = false
    }
  }, [src, fallback])

  return (
    <div className="glow" aria-hidden="true">
      {layers.map(({ id, colors }) => {
        const [a, b = a, c = b] = colors
        return (
          <div
            key={id}
            className="glow-layer"
            style={{
              background: [
                `radial-gradient(45% 55% at 22% 30%, ${a}, transparent 70%)`,
                `radial-gradient(40% 50% at 78% 24%, ${b}, transparent 70%)`,
                `radial-gradient(55% 45% at 55% 82%, ${c}, transparent 70%)`,
                a,
              ].join(', '),
            }}
          />
        )
      })}
      <div className="glow-shade" />
    </div>
  )
}
