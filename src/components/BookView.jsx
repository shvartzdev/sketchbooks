import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addPages, deletePage, getBook, listPages, updateBook, updatePage, uid } from '../lib/db.js'
import { prepareScans } from '../lib/images.js'
import { deriveCropH } from '../lib/crop.js'
import { askPermission, folderState, getFolder, syncBook } from '../lib/folder.js'
import { bookToPdf } from '../lib/pdf.js'
import { useFlipper } from '../lib/flip.js'
import { loadBook } from '../lib/library.js'
import { EDITOR } from '../lib/mode.js'
import Overview from './Overview.jsx'
import PageRail from './PageRail.jsx'
import PageContent from './PageContent.jsx'
import PageEditor from './PageEditor.jsx'
import PageZoom from './PageZoom.jsx'
import { Confirm, NumberAsk } from './Dialog.jsx'

/*
 * Книжка собрана из листов. Лист i — одна физическая бумажка:
 * лицо = слот 2i, оборот = слот 2i+1. Слоты идут так:
 *   0 — обложка, 1 — форзац, дальше страницы.
 * Поэтому книжка открывается на обложке, а первая страница ложится справа,
 * как в настоящей книге. Позиция t — сколько листов перевёрнуто.
 */

const WINDOW = 6 // сколько листов держим смонтированными по каждую сторону

/*
 * Стопка под разворотом. Каждый следующий лист выступает чуть меньше
 * предыдущего — так лежит настоящая пачка бумаги, у которой края к низу
 * сходятся. Уменьшение скромное: оно съедает вылет с обеих сторон.
 */
const PEEK_STEPS = [11, 9, 7.5, 6, 5]
const PEEK_OFFSET = PEEK_STEPS.reduce(
  (acc, step) => [...acc, acc[acc.length - 1] + step],
  [0],
)
const PEEK_MAX = PEEK_STEPS.length
const peekShift = (n) => PEEK_OFFSET[Math.min(PEEK_MAX, Math.round(n))]
const peekScale = (n) => 1 - Math.min(PEEK_MAX, n) * 0.006

// Насколько лист выступает из-под разворота: справа считаем от первого
// нераскрытого, слева — от того, что лежит под левой страницей.
const peekOf = (d) => (d > 0 ? Math.min(PEEK_MAX, d) : Math.max(0, Math.min(PEEK_MAX, -d - 1)))
const REFERENCE_MM = { w: 210, h: 297 } // A4 — эталон масштаба на сцене
const COVER_SLOTS = 2

export default function BookView({ bookId, onBack, entrance = null, onEntered }) {
  const [book, setBook] = useState(null)
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState(false)
  const [importing, setImporting] = useState(null)
  const [dropping, setDropping] = useState(false)
  const [selected, setSelected] = useState(0)
  const [editing, setEditing] = useState(null) // индекс страницы, открытой крупно
  const [ask, setAsk] = useState(null)
  const [zoom, setZoom] = useState(null) // страница, открытая крупно (витрина)
  const [renaming, setRenaming] = useState(false)
  const [notice, setNotice] = useState(null) // что не удалось прочитать
  const [sync, setSync] = useState({ state: 'none' }) // как дела с папкой на диске

  const stageRef = useRef(null)
  const spreadRef = useRef(null)
  const leftBlockRef = useRef(null)
  const rightBlockRef = useRef(null)
  const leafEls = useRef(new Map())
  const strideRef = useRef(1)
  const [box, setBox] = useState({ w: 0, h: 0 })

  // Книжка целиком: обложка и форзац спереди, страницы, форзац и задняя
  // обложка сзади. Если страниц нечётное число, последний лист остаётся
  // с чистым оборотом — как в настоящей книжке.
  const slots = useMemo(() => {
    const inner = pages.map((page, i) => ({ kind: 'page', page, number: i + 1, index: i }))
    if (inner.length % 2 === 1) inner.push({ kind: 'blank' })
    return [
      { kind: 'cover' },
      { kind: 'endpaper' },
      ...inner,
      { kind: 'endpaper' },
      { kind: 'backcover' },
    ]
  }, [pages])
  const leaves = slots.length / 2
  const maxTurn = pages.length === 0 ? 0 : leaves
  const leavesRef = useRef(leaves)
  leavesRef.current = leaves

  // Положение листа по позиции t. Той же формулой ставим лист при первой
  // отрисовке: иначе кадр до layout() все листы лежат стопкой без поворота,
  // и вместо обложки успевает мелькнуть страница из середины.
  const leafTransform = (i, t) => {
    const d = i - t
    const turn = Math.max(0, Math.min(1, t - i))
    // Выглядывают только листы ЗА разворотом. Сам разворот — это лист t
    // (правая страница) и лист t-1 (левая), они стоят ровно, без смещения:
    // иначе левая страница выглядит утопленной.
    const peek = peekOf(d)
    const shift = peekShift(peek).toFixed(1)
    const scale = peekScale(peek).toFixed(4)
    return {
      transform:
        `rotateY(${(-turn * 180).toFixed(2)}deg)` +
        ` translateZ(${(-d * 0.6).toFixed(2)}px)` +
        ` translateX(${shift}px) scale(${scale})`,
      zIndex: turn > 0.001 && turn < 0.999 ? 900 : 10,
      '--turn': Math.sin(turn * Math.PI).toFixed(3),
    }
  }

  const layout = useCallback((t) => {
    leafEls.current.forEach((el) => {
      if (!el) return
      const i = Number(el.dataset.i)
      const d = i - t
      const turn = Math.max(0, Math.min(1, t - i))
      const peek = peekOf(d)
      el.style.transform =
        `rotateY(${(-turn * 180).toFixed(2)}deg)` +
        ` translateZ(${(-d * 0.6).toFixed(2)}px)` +
        ` translateX(${peekShift(peek).toFixed(1)}px) scale(${peekScale(peek).toFixed(4)})`
      el.style.zIndex = turn > 0.001 && turn < 0.999 ? '900' : '10'
      el.style.setProperty('--turn', Math.sin(turn * Math.PI).toFixed(3))
    })
    // Половинки бумажного блока — это подложка под стопку листов, и нужны они
    // только там, где стопка есть. Слева она появляется, когда первый лист уже
    // лёг (и сам её закрывает, так что включение не видно), справа исчезает,
    // когда перевёрнут последний. Иначе у краёв книжки висит лишняя страница.
    if (leftBlockRef.current) leftBlockRef.current.style.opacity = t >= 0.98 ? '1' : '0'
    if (rightBlockRef.current) {
      rightBlockRef.current.style.opacity = t <= leavesRef.current - 0.98 ? '1' : '0'
    }
  }, [])

  const { index, posRef, goTo, step, handlers, onWheel, wasDragged } = useFlipper({
    count: maxTurn + 1,
    strideRef,
    onFrame: layout,
  })

  const goToPage = useCallback(
    (p, opts) => goTo(Math.min(maxTurn, Math.round((p + COVER_SLOTS) / 2)), opts),
    [goTo, maxTurn],
  )

  // Переход к только что добавленной странице нельзя делать сразу: предел
  // листания считается по текущему списку страниц, и цель обрезалась бы
  // старым концом книжки. Поэтому запоминаем цель и прыгаем следующим кадром.
  const [pendingPage, setPendingPage] = useState(null)

  const pickPage = useCallback(
    (p) => {
      setSelected(p)
      goToPage(p)
    },
    [goToPage],
  )
  const askDeletePage = useCallback(() => setAsk({ type: 'deletePage' }), [])
  const pickFromOverview = useCallback(
    (p) => {
      setSelected(p)
      goToPage(p)
      setOverview(false)
    },
    [goToPage],
  )

  // что сейчас на развороте
  const leftSlot = slots[index * 2 - 1]
  const rightSlot = slots[index * 2]
  const activePages = useMemo(
    () => [leftSlot, rightSlot].filter((s) => s?.kind === 'page').map((s) => s.index),
    [leftSlot, rightSlot],
  )

  useEffect(() => {
    if (activePages.length && !activePages.includes(selected)) {
      setSelected(activePages[activePages.length - 1])
    }
  }, [activePages, selected])

  /*
   * Раскрытие. Книжка возникает на месте корешка на полке, вырастает к зрителю
   * и по дороге распахивается на первый разворот: обложка уезжает влево той же
   * пружиной, что и обычное листание. Полка под ней в это время гаснет.
   */
  const opened = useRef(false)
  const enter = useRef({})
  enter.current = { entrance, goTo, onEntered }
  const timers = useRef([])

  useEffect(() => {
    if (loading || opened.current || !pages.length) return
    const { entrance: from } = enter.current
    const el = spreadRef.current
    // Полёт возможен только когда сцена измерена: до этого разворот нулевой
    // и лететь неоткуда. Ждём — эффект вернётся, когда размер появится.
    if (from && (!el || !box.w)) return
    opened.current = true

    if (el && from) {
      const to = el.getBoundingClientRect()
      const scale = from.height / to.height
      const dx = from.left + from.width / 2 - (to.left + to.width / 2)
      const dy = from.top + from.height / 2 - (to.top + to.height / 2)
      el.animate(
        [
          { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})` },
          { transform: 'translate(-50%, -50%) scale(1)' },
        ],
        { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      )
    }
    // Таймеры одноразовые и живут вне уборки эффекта: иначе повторный запуск
    // эффекта (функции приходят новыми на каждый рендер) гасил бы их, и книжка
    // не раскрывалась бы и не «приземлялась».
    timers.current = [
      setTimeout(() => enter.current.goTo(1), from ? 150 : 120),
      setTimeout(() => enter.current.onEntered?.(), from ? 470 : 0),
    ]
  }, [loading, pages.length, box.w])

  // Страховка: если сцена так и не измерилась, книжка всё равно открывается —
  // просто без полёта, а не остаётся висеть на полке.
  useEffect(() => {
    if (loading || !pages.length) return
    const t = setTimeout(() => {
      if (opened.current) return
      opened.current = true
      enter.current.goTo(1)
      enter.current.onEntered?.()
    }, 600)
    return () => clearTimeout(t)
  }, [loading, pages.length])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (pendingPage == null) return
    // без анимации: пролистывать полкниги пружиной после каждого добавления незачем
    goToPage(pendingPage, { instant: true })
    setPendingPage(null)
  }, [pendingPage, goToPage])

  /* ---------- данные ---------- */

  const reload = useCallback(async () => {
    const fresh = await listPages(bookId)
    setPages(fresh)
    return fresh
  }, [bookId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { book: b, pages: p } = await loadBook(bookId)
        if (!alive) return
        setBook(b)
        setPages(p)
      } catch {
        if (alive) setBook(null)
      }
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [bookId])

  /* ---------- размер разворота ---------- */

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !book) return
    const measure = () => {
      const rect = stage.getBoundingClientRect()
      // На телефоне разворот и так еле помещается по ширине, поэтому там книжка
      // занимает экран целиком; на большом экране остаются поля.
      const narrow = rect.width < 700
      const maxW = rect.width * (narrow ? 0.98 : 0.9)
      const maxH = rect.height * (narrow ? 0.94 : 0.88)
      // Масштаб общий для всех книжек: сцену целиком занимает разворот A4,
      // а всё меньшее показывается настолько же меньше — маленький блокнот
      // и должен выглядеть маленьким. Формат крупнее A4 просто вписываем.
      // Общая мерка нужна, когда книжки видны рядом; на телефоне книжка всегда
      // одна на экране, и держать её мелкой ради сравнения не с чем.
      const fit = (wMm, hMm) => Math.min(maxW / (wMm * 2), maxH / hMm)
      const own = fit(book.widthMm, book.heightMm)
      const pxPerMm = narrow ? own : Math.min(own, fit(REFERENCE_MM.w, REFERENCE_MM.h))
      const w = book.widthMm * 2 * pxPerMm
      const h = book.heightMm * pxPerMm
      // ход листания: столько пикселей ведения — один лист; дальше по сцене
      // включается непрерывная прокрутка
      strideRef.current = Math.max(60, Math.min(140, rect.width * 0.09))
      setBox({ w: Math.round(w / 2), h: Math.round(h) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [book, overview])

  useLayoutEffect(() => {
    layout(posRef.current)
  }, [layout, posRef, index, pages, box, overview])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [onWheel, overview, pages.length])

  /* ---------- клавиатура ---------- */

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches?.('input, textarea')) return
      if (editing !== null || ask || zoom !== null) return // модалки разбираются с клавишами сами
      if (e.key === 'Escape') {
        if (overview) setOverview(false)
        else onBack()
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        step(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        step(-1)
      } else if (e.key === 'Home') {
        goTo(0)
      } else if (e.key === 'End') {
        goTo(maxTurn)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask, editing, goTo, maxTurn, onBack, overview, step, zoom])

  // сообщение само уходит: это уведомление, а не диалог
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 9000)
    return () => clearTimeout(id)
  }, [notice])

  const reportFailed = useCallback((prepared) => {
    const failed = prepared.failed || []
    if (!failed.length) return
    const shown = failed.slice(0, 3).join(', ')
    const rest = failed.length > 3 ? ` и ещё ${failed.length - 3}` : ''
    setNotice(`Не удалось прочитать: ${shown}${rest}`)
  }, [])

  /* ---------- страницы ---------- */

  const addBlanks = useCallback(
    async (count) => {
      const n = Math.max(1, Math.min(500, Math.round(count) || 0))
      await addPages(
        bookId,
        Array.from({ length: n }, () => ({ items: [] })),
      )
      const fresh = await reload()
      setPendingPage(fresh.length - n)
    },
    [bookId, reload],
  )

  // доли страницы под картинку: вписываем целиком, пропорции сохраняем
  const fitItem = useCallback(
    (prepared, fill = 0.72, nudge = 0) => {
      const pageAspect = book.widthMm / book.heightMm
      const imgAspect = prepared.w / prepared.h
      let w = fill
      let h = (w * pageAspect) / imgAspect
      if (h > fill) {
        const k = fill / h
        w *= k
        h *= k
      }
      return {
        id: uid(),
        blob: prepared.blob,
        thumb: prepared.thumb,
        iw: prepared.w, // размеры исходника — по ним считается кадрирование
        ih: prepared.h,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        w,
        h,
        x: Math.min(1 - w, Math.max(0, (1 - w) / 2 + nudge)),
        y: Math.min(1 - h, Math.max(0, (1 - h) / 2 + nudge)),
      }
    },
    [book],
  )

  // «Добавить изображение» — кладём картинки на выбранную страницу
  const addImagesToPage = useCallback(
    async (files, pageIndex) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!list.length) return
      setImporting({ done: 0, total: list.length })
      const prepared = await prepareScans(list, (done, total) => setImporting({ done, total }))
      setImporting(null)
      reportFailed(prepared)
      if (!prepared.length) return

      let target = pageIndex
      let current = pages
      if (target == null || !current[target]) {
        await addPages(bookId, [{ items: [] }])
        current = await reload()
        target = current.length - 1
      }
      const page = current[target]
      const base = page.items?.length || 0
      const items = [
        ...(page.items || []),
        ...prepared.map((p, i) => fitItem(p, 0.72, (base + i) * 0.03)),
      ]
      await updatePage(page.id, { items })
      await reload()
      setSelected(target)
      setPendingPage(target)
      setEditing(target)
    },
    [bookId, fitItem, goToPage, pages, reload, reportFailed],
  )

  // Половина снимка разворота: рамка во всю страницу, а кадр показывает
  // левую или правую часть фотографии. Две такие страницы, оказавшись рядом,
  // складываются обратно в целый снимок.
  const halfItem = useCallback(
    (prepared, side) => {
      const pageAspect = book.widthMm / book.heightMm
      const imgAspect = prepared.w / prepared.h
      const frame = { x: 0, y: 0, w: 1, h: 1 }
      let w = 0.5
      let h = deriveCropH(w, frame, pageAspect, imgAspect)
      if (h > 1) {
        w /= h
        h = 1
      }
      // Половинки идут встык по середине снимка: левая заканчивается ровно там,
      // где начинается правая. Если снимок шире разворота, лишнее срезается
      // по внешним краям — а не выпадает полоской из середины картинки.
      return {
        ...frame,
        id: uid(),
        blob: prepared.blob,
        thumb: prepared.thumb,
        iw: prepared.w,
        ih: prepared.h,
        rot: 0,
        crop: {
          w,
          h,
          x: side === 'left' ? Math.max(0, 0.5 - w) : Math.min(1 - w, 0.5),
          y: (1 - h) / 2,
        },
      }
    },
    [book],
  )

  // Снимок раскрытого скетчбука: режем пополам и кладём на тот разворот,
  // который сейчас открыт — на левую страницу левую половину, на правую правую.
  // Если разворот неполный (стоим на обложке) или снимков несколько, лишнее
  // уходит новыми разворотами в конец.
  const addSpreadImages = useCallback(
    async (files) => {
      const list = Array.from(files).filter(
        (f) => f.type.startsWith('image/') || /\.hei[cf]$/i.test(f.name || ''),
      )
      if (!list.length) return
      setImporting({ done: 0, total: list.length })
      const prepared = await prepareScans(list, (done, total) => setImporting({ done, total }))
      setImporting(null)
      reportFailed(prepared)
      if (!prepared.length) return

      const left = leftSlot?.kind === 'page' ? leftSlot.index : null
      const right = rightSlot?.kind === 'page' ? rightSlot.index : null
      let rest = prepared

      if (left != null && right != null) {
        const shot = prepared[0]
        rest = prepared.slice(1)
        const leftPage = pages[left]
        const rightPage = pages[right]
        await updatePage(leftPage.id, {
          items: [...(leftPage.items || []), halfItem(shot, 'left')],
        })
        await updatePage(rightPage.id, {
          items: [...(rightPage.items || []), halfItem(shot, 'right')],
        })
      }

      if (rest.length) {
        // соседние страницы — это пара «нечётная, чётная» в счёте с нуля,
        // поэтому иногда нужен один добор, чтобы разворот не разъехался
        const filler = pages.length % 2 === 0 ? 1 : 0
        const additions = filler ? [{ items: [] }] : []
        rest.forEach((p) => {
          additions.push({ items: [halfItem(p, 'left')] })
          additions.push({ items: [halfItem(p, 'right')] })
        })
        await addPages(bookId, additions)
      }

      await reload()
      if (rest.length) {
        setPendingPage(pages.length + (pages.length % 2 === 0 ? 1 : 0))
        if (rest.length < prepared.length) {
          setNotice('Первый снимок лёг на открытый разворот, остальные — новыми в конец')
        }
      } else {
        setSelected(left)
      }
    },
    [bookId, halfItem, leftSlot, pages, reload, reportFailed, rightSlot],
  )

  /* ---------- автосохранение в папку ---------- */

  // Любое изменение книжки или её страниц через паузу уезжает в привязанную
  // папку. Пауза нужна, чтобы возня с картинкой не писала на диск по кадру.
  const syncTimer = useRef(0)
  const runSync = useCallback(async () => {
    const handle = await getFolder()
    if (!handle) return setSync({ state: 'none' })
    const name = handle.name
    if ((await folderState(handle)) !== 'granted') return setSync({ state: 'prompt', name })
    setSync({ state: 'saving', name })
    try {
      const res = await syncBook(bookId)
      setSync({ state: 'saved', name, slug: res?.slug })
    } catch (err) {
      setSync({ state: 'error', name, message: err.message })
    }
  }, [bookId])

  useEffect(() => {
    if (loading || !EDITOR) return
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(runSync, 1200)
    return () => clearTimeout(syncTimer.current)
  }, [book, pages, loading, runSync])

  // PDF — это гостинец наружу: показать, распечатать, отправить. В папку
  // репозитория он намеренно не кладётся, иначе каждая пересборка добавляла бы
  // в git многомегабайтный файл целиком.
  const savePdf = async () => {
    try {
      setImporting({ done: 0, total: pages.length, label: 'Собираем PDF' })
      const { blob, name, pages: count } = await bookToPdf(bookId, {
        onProgress: (done, total) => setImporting({ done, total, label: 'Собираем PDF' }),
        source: EDITOR ? undefined : { book, pages },
      })
      setImporting(null)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 20000)
      setNotice(`PDF готов: ${name}, страниц ${count}`)
    } catch (err) {
      setImporting(null)
      setNotice(`Не получилось собрать PDF: ${err.message}`)
    }
  }

  const grantFolder = async () => {
    const handle = await getFolder()
    if (!handle) return
    if ((await askPermission(handle)) === 'granted') runSync()
    else setSync({ state: 'prompt', name: handle.name })
  }

  // перетаскивание файлов — каждая картинка становится отдельной страницей
  const addPagesFromImages = useCallback(
    async (files) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (!list.length) return
      setImporting({ done: 0, total: list.length })
      const prepared = await prepareScans(list, (done, total) => setImporting({ done, total }))
      setImporting(null)
      reportFailed(prepared)
      if (!prepared.length) return
      await addPages(
        bookId,
        prepared.map((p) => ({ items: [fitItem(p, 0.88)] })),
      )
      const fresh = await reload()
      setPendingPage(fresh.length - prepared.length)
    },
    [bookId, fitItem, reload, reportFailed],
  )

  // Старые страницы держат скан подложкой во всю страницу. Перед правкой
  // превращаем его в обычную картинку — тогда её можно двигать и кадрировать.
  // Рамку подбираем «по картинке», так что внешне страница не меняется.
  const ensureEditable = useCallback(
    async (i) => {
      const page = pages[i]
      if (!page?.blob) return
      const item = fitItem({ blob: page.blob, thumb: page.thumb, w: page.w, h: page.h }, 1)
      await updatePage(page.id, {
        items: [item, ...(page.items || [])],
        blob: null,
        thumb: null,
      })
      await reload()
    },
    [fitItem, pages, reload],
  )

  const openEditor = useCallback(
    async (i) => {
      setSelected(i)
      if (!EDITOR) return setZoom(i)
      await ensureEditable(i)
      setEditing(i)
    },
    [ensureEditable],
  )

  const saveItems = useCallback(async (pageId, items) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, items } : p)))
    await updatePage(pageId, { items })
  }, [])

  const removeSelected = async () => {
    const page = pages[selected]
    setAsk(null)
    if (!page) return
    await deletePage(page.id)
    const fresh = await reload()
    if (fresh.length) {
      const next = Math.min(selected, fresh.length - 1)
      setSelected(next)
      goToPage(next)
    } else {
      goTo(0, { instant: true })
    }
  }

  const commitRename = async (value) => {
    setRenaming(false)
    const title = value.trim() || 'Без названия'
    if (title !== book.title) setBook(await updateBook(bookId, { title }))
  }

  if (loading) return <p className="muted center">Загружаем…</p>
  if (!book) {
    return (
      <div className="empty">
        <p>Скетчбук не найден.</p>
        <button className="btn" onClick={onBack}>
          На полку
        </button>
      </div>
    )
  }

  // клик по половине разворота: обложку открываем, страницу рассматриваем крупно
  const onStageClick = (e) => {
    if (wasDragged() || !pages.length) return
    const rect = stageRef.current.getBoundingClientRect()
    const slot = e.clientX < rect.left + rect.width / 2 ? leftSlot : rightSlot
    if (slot?.kind === 'cover') step(1)
    else if (slot?.kind === 'page') openEditor(slot.index)
  }

  const moveEditing = async (d) => {
    if (editing === null) return
    const next = Math.min(pages.length - 1, Math.max(0, editing + d))
    setSelected(next)
    goToPage(next)
    await ensureEditable(next)
    setEditing(next)
  }

  const from = Math.max(0, index - WINDOW)
  const to = Math.min(leaves - 1, index + WINDOW)
  const visibleLeaves = []
  for (let i = from; i <= to; i++) visibleLeaves.push(i)

  const aspect = book.widthMm / book.heightMm

  return (
    <div
      className={'book-screen' + (dropping ? ' dropping' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        if (EDITOR) setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget) || setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        if (EDITOR && e.dataTransfer?.files?.length) addPagesFromImages(e.dataTransfer.files)
      }}
    >
      <header className="topbar">
        <button className="link-btn" onClick={onBack}>
          ← Полка
        </button>
        {!EDITOR ? (
          <span className="book-name book-name-static">{book.title}</span>
        ) : renaming ? (
          <input
            className="book-name-input"
            defaultValue={book.title}
            autoFocus
            maxLength={80}
            onBlur={(e) => commitRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button className="book-name" onClick={() => setRenaming(true)} title="Переименовать">
            {book.title}
          </button>
        )}
        <div className="topbar-right">
          {pages.length > 0 && (
            <span className="counter">
              {activePages.length
                ? activePages.map((p) => p + 1).join('–')
                : index === 0
                  ? 'обложка'
                  : 'задняя обложка'}{' '}
              / {pages.length}
            </span>
          )}
          <button className="btn" onClick={() => setOverview((v) => !v)} disabled={!pages.length}>
            {overview ? 'Листать' : 'Все страницы'}
          </button>
          {EDITOR && (
            <>
              <button className="btn" onClick={() => setAsk({ type: 'blanks' })}>
                Добавить страницы
              </button>
              <label className="btn btn-primary">
                На страницу
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={(e) => {
                    addImagesToPage(e.target.files, pages.length ? selected : null)
                    e.target.value = ''
                  }}
                />
              </label>
              <label className="btn" title="Снимок раскрытого скетчбука — ляжет на две страницы">
                На разворот
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  hidden
                  onChange={(e) => {
                    addSpreadImages(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          <button className="btn" onClick={savePdf} disabled={!pages.length} title="Вся книжка одним файлом">
            PDF
          </button>
          {!EDITOR ? null : sync.state === 'prompt' ? (
            <button className="btn" onClick={grantFolder} title={`Папка «${sync.name}»`}>
              Разрешить запись
            </button>
          ) : sync.state !== 'none' ? (
            <span className={'sync sync-' + sync.state} title={sync.message || sync.name}>
              {sync.state === 'saving'
                ? 'Сохраняем…'
                : sync.state === 'saved'
                  ? `Сохранено в ${sync.name}`
                  : 'Ошибка записи'}
            </span>
          ) : null}
        </div>
      </header>

      {overview ? (
        <Overview pages={pages} current={selected} aspect={aspect} onPick={pickFromOverview} />
      ) : (
        <>
          <div className="stage" ref={stageRef} onClick={onStageClick} {...handlers}>
            {pages.length === 0 ? (
              <div className="empty stage-empty" data-no-drag>
                <p>В скетчбуке пока нет страниц.</p>
                <p className="muted">
                  Добавьте пустых страниц и наполняйте их изображениями — или перетащите картинки
                  сюда, каждая станет отдельной страницей.
                </p>
                {EDITOR && (
                  <div className="empty-actions">
                    <button className="btn btn-primary" onClick={() => setAsk({ type: 'blanks' })}>
                      Добавить страницы
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="spread" ref={spreadRef} style={{ width: box.w * 2, height: box.h }}>
                <div className="block block-left" ref={leftBlockRef} />
                <div className="block block-right" ref={rightBlockRef} />
                {visibleLeaves.map((i) => (
                  <div
                    key={i}
                    data-i={i}
                    className="leaf"
                    style={{ width: box.w, height: box.h, ...leafTransform(i, posRef.current) }}
                    ref={(el) => {
                      if (el) leafEls.current.set(i, el)
                      else leafEls.current.delete(i)
                    }}
                  >
                    {/* Ближние листы рисуем полными снимками, дальние —
                        миниатюрами: пустых страниц при листании быть не должно,
                        но и декодировать десяток полноразмерных снимков незачем. */}
                    <Face
                      slot={slots[i * 2]}
                      side="front"
                      book={book}
                      thumbs={Math.abs(i - index) > 1}
                    />
                    <Face
                      slot={slots[i * 2 + 1]}
                      side="back"
                      book={book}
                      thumbs={Math.abs(i - index) > 1}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {pages.length > 0 && (
            <p className="stage-hint">Коснитесь страницы, чтобы рассмотреть её целиком</p>
          )}

          {pages.length > 0 && (
            <PageRail
              pages={pages}
              active={activePages}
              selected={selected}
              aspect={aspect}
              onPick={pickPage}
              onDelete={EDITOR ? askDeletePage : null}
            />
          )}
        </>
      )}

      {importing && (
        <div className="toast">
          {importing.label || 'Обрабатываем изображения'}… {importing.done} / {importing.total}
        </div>
      )}
      {dropping && <div className="drop-hint">Отпустите — каждая картинка станет страницей</div>}
      {notice && (
        <button className="toast toast-warn" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}

      {zoom !== null && (
        <PageZoom
          pages={pages}
          index={zoom}
          aspect={aspect}
          onMove={(d) => {
            const next = Math.min(pages.length - 1, Math.max(0, zoom + d))
            setZoom(next)
            setSelected(next)
            goToPage(next)
          }}
          onClose={() => setZoom(null)}
        />
      )}

      {editing !== null && pages[editing] && (
        <PageEditor
          page={pages[editing]}
          number={editing + 1}
          total={pages.length}
          aspect={aspect}
          canPrev={editing > 0}
          canNext={editing < pages.length - 1}
          busy={!!importing}
          onMove={moveEditing}
          onClose={() => setEditing(null)}
          onChange={saveItems}
          onAddImage={(files) => addImagesToPage(files, editing)}
        />
      )}

      {ask?.type === 'blanks' && (
        <NumberAsk
          title="Добавить страницы"
          hint={`Пустые страницы формата ${book.widthMm}×${book.heightMm} мм — их можно наполнять изображениями.`}
          presets={[2, 8, 24, 48]}
          initial={8}
          onCancel={() => setAsk(null)}
          onSubmit={(n) => {
            setAsk(null)
            addBlanks(n)
          }}
        />
      )}

      {ask?.type === 'deletePage' && (
        <Confirm
          title={`Удалить страницу ${selected + 1}?`}
          text="Страница и всё, что на ней собрано, пропадут безвозвратно."
          onCancel={() => setAsk(null)}
          onConfirm={removeSelected}
        />
      )}
    </div>
  )
}

function Face({ slot, side, book, thumbs = false }) {
  const kind = slot?.kind ?? 'empty'
  const isCover = kind === 'cover' || kind === 'backcover'
  return (
    <div
      className={`face face-${side} face-${kind}`}
      style={isCover ? { background: book.coverColor } : undefined}
    >
      {kind === 'cover' && (
        <div className="cover-plate">
          <span className="cover-title">{book.title}</span>
          <span className="cover-format">
            {book.widthMm}×{book.heightMm} мм
          </span>
        </div>
      )}
      {kind === 'page' && (
        <PageContent
          page={slot.page}
          number={slot.number}
          side={side === 'front' ? 'right' : 'left'}
          thumbs={thumbs}
        />
      )}
      <div className="face-gutter" />
      <div className="face-turn" />
    </div>
  )
}
