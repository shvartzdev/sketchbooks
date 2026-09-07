import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  createBook,
  deleteBook,
  listBooks,
  getMeta,
  placeBooks,
  setMeta,
  updateBook,
} from '../lib/db.js'
import { exportBook, importMissing } from '../lib/exchange.js'
import { loadArtwork, loadShelf } from '../lib/library.js'
import { EDITOR } from '../lib/mode.js'
import {
  askPermission,
  folderState,
  getFolder,
  linkFolder,
  supported,
  syncBook,
  unlinkFolder,
} from '../lib/folder.js'
import { EMPTY_ART, Painting, arrangeArt } from './Decor.jsx'
import BookSettings from './BookSettings.jsx'
import { yearLines } from '../lib/years.js'
import { blobUrl } from '../lib/images.js'
import NewBookDialog from './NewBookDialog.jsx'
import { Confirm } from './Dialog.jsx'

// Загруженные работы переживают уход на книжку и обратно: иначе при возврате
// полка секунду стоит с пустыми рамами и потом дёргается, когда работы придут.
let artCache = null

// Скетчбуки стоят корешками наружу: высота — от формата книжки, толщина — от
// числа страниц. Шкаф занимает весь экран, полки повторяются сверху вниз,
// и книжки переходят на следующую, когда ряд кончился.
const BOARD = 16 // толщина доски, из CSS
const REFERENCE_MM = 300 // книжка такой высоты занимает полку целиком (A4 — почти)
const GAP = 7 // расстояние между корешками, из CSS

const FLOOR = 10 // общий низ: нижняя полка и большая рама стоят на одной линии
const BOARD_H = 12 // толщина доски, из CSS
const BOOKS_PER_SHELF = 2 // полки короткие: две книжки и пара предметов
// Места на стене: полки развешены по сетке, а не сложены в угол.
const SPOTS = [
  { col: 1, row: 1 },
  { col: 1, row: 3 },
  { col: 3, row: 3 },
  { col: 4, row: 1 },
  { col: 3, row: 4 },
]
const ART_SPOT = { col: 2, row: 1, span: 2 }
// Толщина корешка от числа страниц. Шкала намеренно скромная: тетрадка на два
// десятка страниц и должна выглядеть тетрадкой, а не томом.
const spineWidth = (pages) => Math.round(Math.min(64, Math.max(24, 12 + pages * 0.42)))
// на узком корешке шрифт мельче, иначе название не влезает в две строки
const titleSize = (w) => Math.max(9, Math.min(13, Math.round(w * 0.38 * 10) / 10))

export default function Shelf({ onOpen }) {
  const [books, setBooks] = useState(null)
  const [summaries, setSummaries] = useState({})
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [editing, setEditing] = useState(null) // скетчбук, у которого правим название и формат
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const [folder, setFolder] = useState(null) // { name, state }
  // Первое значение берём от окна, а не наугад: иначе первый кадр рисуется
  // в чужом масштабе и стена заметно дёргается, когда приходит настоящий размер.
  const [wall, setWall] = useState(() => ({
    w: Math.max(320, window.innerWidth - 60),
    h: Math.max(320, window.innerHeight - 120),
  }))
  // Телефон: стена с рейками на 375 пикселях превращается в кашу, поэтому там
  // полка становится списком — обложка, название, год.
  const [narrow, setNarrow] = useState(() => window.innerWidth < 760)
  const [drag, setDrag] = useState(null) // { index, to, dx, dy, width, settling }
  const [dragArt, setDragArt] = useState(null) // перетаскиваемая рама
  const dragRef = useRef(null)
  const rowRef = useRef(null)
  const draggedAt = useRef(0)
  const topLedgeRef = useRef(null)
  const bottomLedgeRef = useRef(null)
  const [artworks, setArtworks] = useState(() => artCache || EMPTY_ART)
  const artItems = useRef([]) // загруженные работы, чтобы переставлять их местами
  const artDrag = useRef(null)

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 760)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // сетка стены меряется по месту: сколько рядов и столбцов поместилось
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setWall({ w: r.width, h: Math.max(320, window.innerHeight - r.top - 24) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [books])

  // Развеска как на стене: две длинные рейки во всю ширину. Масштаб задаёт
  // работа — два A4 по вертикали занимают три четверти высоты стены, книжка A4
  // выходит вдвое меньше, предметы — мелочь между ними.
  const pxPerMm = (wall.h * 0.75) / 594
  const TOP_LEDGE = 0.52 // доля высоты стены, на которой висит верхняя полка
  const spineHeight = useCallback((mm) => Math.round(mm * pxPerMm), [pxPerMm])


  // Работы из подпапки art привязанной папки: читаем файлы, узнаём пропорции
  // и расставляем по местам на стене.
  const loadArt = useCallback(async () => {
    const items = await loadArtwork()
    const order = (EDITOR && (await getMeta('artOrder'))) || []
    artItems.current = items
    const arranged = items.length ? arrangeArt(items, order) : EMPTY_ART
    artCache = arranged
    setArtworks(arranged)

  }, [])

  const load = useCallback(async () => {
    const { books: list, summaries: sums } = await loadShelf()
    setBooks(list)
    setSummaries(sums)
  }, [])

  const refreshFolder = useCallback(async () => {
    if (!EDITOR) return setFolder(null)
    const handle = await getFolder()
    setFolder(handle ? { name: handle.name, state: await folderState(handle) } : null)
  }, [])

  useEffect(() => {
    load()
    refreshFolder().then(loadArt)
  }, [load, refreshFolder, loadArt])

  // При привязке папки сразу выкладываем в неё всё, что уже есть на полке:
  // иначе книжка попадёт на диск только когда её откроют, а это не очевидно.
  const pushAllToFolder = useCallback(async (handle) => {
    const books = await listBooks()
    if (!books.length) return
    try {
      for (let i = 0; i < books.length; i++) {
        setBusy({ done: i, total: books.length, label: 'Сохраняем в папку' })
        await exportBook(books[i].id, handle)
      }
      setBusy(null)
      setNotice(`Сохранено в папку: ${books.length === 1 ? books[0].title : `книжек ${books.length}`}`)
    } catch (err) {
      setBusy(null)
      setNotice(`Не получилось сохранить: ${err.message}`)
    }
  }, [])

  // Из папки в браузер — не кнопка, а следствие привязки: если в папке есть
  // скетчбуки, которых тут нет (после git clone на другой машине), они просто
  // появляются на полке.
  const pickUpFromFolder = useCallback(async (handle) => {
    try {
      const known = (await listBooks()).map((b) => b.slug).filter(Boolean)
      setBusy({ done: 0, total: 1 })
      const added = await importMissing(handle, known, (done, total) => setBusy({ done, total }))
      setBusy(null)
      if (added.length) {
        await load()
        setNotice(`Из папки добавлено: ${added.map((b) => b.title).join(', ')}`)
      }
    } catch (err) {
      setBusy(null)
      setNotice(`Не получилось прочитать папку: ${err.message}`)
    }
  }, [load])

  const chooseFolder = async () => {
    if (!supported()) {
      setNotice('Папку на диске умеют Chrome и Edge — в Safari такого API нет')
      return
    }
    try {
      const handle = await linkFolder()
      await refreshFolder()
      await pushAllToFolder(handle)
      await pickUpFromFolder(handle)
      await loadArt()
    } catch (err) {
      if (err.name !== 'AbortError') setNotice(`Не получилось привязать папку: ${err.message}`)
    }
  }

  const grantFolder = async () => {
    const handle = await getFolder()
    if (!handle) return
    if ((await askPermission(handle)) === 'granted') {
      await pushAllToFolder(handle)
      await pickUpFromFolder(handle)
      await loadArt()
    }
    refreshFolder()
  }

  const forgetFolder = async () => {
    await unlinkFolder()
    refreshFolder()
  }

  const create = async (data) => {
    const book = await createBook(data)
    setDialog(false)
    onOpen(book.id)
  }

  /*
   * Перетаскивание корешков. Соседи разъезжаются на ширину переносимой книжки,
   * сама она едет за курсором, а на отпускании доезжает до места и только тогда
   * порядок фиксируется в базе — иначе список перескакивал бы под рукой.
   */
  const startDrag = (e, shelf, pos) => {
    if (!EDITOR) return
    if (e.button !== undefined && e.button !== 0) return
    // рамки книжек по полкам: место считаем внутри той полки, над которой курсор
    const ledgeEls = [...rowRef.current.querySelectorAll('.ledge')]
    dragRef.current = {
      shelf,
      pos,
      toShelf: shelf,
      toPos: pos,
      startX: e.clientX,
      startY: e.clientY,
      ledges: ledgeEls.map((el) => el.getBoundingClientRect()),
      slots: ledgeEls.map((el) =>
        [...el.querySelectorAll('.spine-slot')].map((n) => n.getBoundingClientRect()),
      ),
      width: e.currentTarget.getBoundingClientRect().width + GAP,
      moved: false,
      el: e.currentTarget,
      pointerId: e.pointerId,
    }
  }

  const moveDrag = (e) => {
    const g = dragRef.current
    if (!g) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    if (!g.moved) {
      g.moved = true
      try {
        g.el.setPointerCapture?.(g.pointerId)
      } catch {
        // без захвата жест доживёт до отпускания и так
      }
    }

    // полка — та, к чьей середине курсор ближе
    const toShelf = g.ledges.reduce(
      (best, r, i) => {
        const d = Math.abs(e.clientY - (r.top + r.height / 2))
        return d < best.d ? { i, d } : best
      },
      { i: g.shelf, d: Infinity },
    ).i

    // место внутри полки: сколько её книжек стоит левее курсора
    let toPos = 0
    ;(g.slots[toShelf] || []).forEach((r, k) => {
      if (toShelf === g.shelf && k === g.pos) return
      if (e.clientX > r.left + r.width / 2) toPos++
    })

    g.toShelf = toShelf
    g.toPos = toPos
    setDrag({ shelf: g.shelf, pos: g.pos, toShelf, toPos, dx, dy, width: g.width })
  }

  const endDrag = async () => {
    const g = dragRef.current
    dragRef.current = null
    if (!g || !g.moved) {
      setDrag(null)
      return
    }
    draggedAt.current = Date.now()
    setDrag(null)

    // собираем новую расстановку: книжка уходит со своей полки и встаёт
    // на выбранную в выбранное место, остальные сдвигаются только в её пределах
    const groups = [shelved[0].slice(), shelved[1].slice()]
    const [moved] = groups[g.shelf].splice(g.pos, 1)
    if (!moved) return
    groups[g.toShelf].splice(Math.min(g.toPos, groups[g.toShelf].length), 0, moved)

    await placeBooks(
      groups.flatMap((group, shelf) => group.map((b, order) => ({ id: b.id, shelf, order }))),
    )
    await load()
  }

  const slotStyle = (shelf, pos) => {
    if (!drag) return undefined
    if (shelf === drag.shelf && pos === drag.pos) {
      return {
        transform: `translate(${drag.dx}px, ${drag.dy}px)`,
        transition: 'none',
        zIndex: 5,
      }
    }
    // соседи расступаются в пределах своей полки
    if (shelf === drag.toShelf && shelf === drag.shelf) {
      if (drag.pos < drag.toPos && pos > drag.pos && pos <= drag.toPos) {
        return { transform: `translateX(${-drag.width}px)` }
      }
      if (drag.toPos < drag.pos && pos >= drag.toPos && pos < drag.pos) {
        return { transform: `translateX(${drag.width}px)` }
      }
      return undefined
    }
    if (shelf === drag.toShelf && pos >= drag.toPos) {
      return { transform: `translateX(${drag.width}px)` }
    }
    if (shelf === drag.shelf && pos > drag.pos) {
      return { transform: `translateX(${-drag.width}px)` }
    }
    return undefined
  }

  // Место книжки — её полка и позиция на ней. У заведённых раньше места нет:
  // расставляем по старому правилу, а дальше хозяин двигает как хочет.
  const shelved = useMemo(() => {
    const list = books || []
    const groups = [[], []]
    list.forEach((book, i) => {
      const shelf = book.shelf ?? (i < BOOKS_PER_SHELF ? 0 : 1)
      groups[shelf === 1 ? 1 : 0].push(book)
    })
    return groups
  }, [books])

  /*
   * Что стоит на полках. Нижняя работа у левого края — самая крупная, стоит
   * на полу; остальные работы висят на полках вперемешку с книжками.
   */
  const ledges = useMemo(() => {
    const mm = (v) => Math.round(v * pxPerMm)
    const bigH = Math.round(TOP_LEDGE * wall.h + BOARD_H + 297 * pxPerMm - FLOOR)
    const frame = (art, big = false) => {
      const h = big ? bigH : mm(art.heightMm)
      const w = art.aspect ? Math.round(h * art.aspect) : mm(art.widthMm)
      return {
        kind: 'art',
        id: art.name || `empty-${art.heightMm}x${art.widthMm}`,
        art,
        h,
        w: Math.min(w, Math.round(wall.w * 0.4)),
        // светлое поле идёт не всем: большой работе и квадрату — тёмное
        dark: big || Math.abs(art.widthMm - art.heightMm) < 20,
      }
    }

    // Три пустые рамки колонкой у правого края: верх первой вровень с верхом
    // большой работы, низ последней — с её низом.
    const gap = Math.round(bigH * 0.05)
    const slotH = Math.round((bigH - gap * 2) / 3)
    const spareW = Math.round(slotH * 0.8)
    const spare = ['a', 'b', 'c'].map((key) => ({
      id: `spare-${key}`,
      h: slotH,
      w: spareW,
      widthMm: Math.round(spareW / pxPerMm),
      heightMm: Math.round(slotH / pxPerMm),
    }))

    const small = artworks.small.length ? artworks.small : EMPTY_ART.small
    const framed = small.map((art, i) => ({ ...frame(art), slot: String(i) }))

    return {
      spare,
      spareGap: gap,
      big: frame(artworks.big || EMPTY_ART.big, true),
      top: [
        ...shelved[0].map((book, i) => ({ kind: 'book', id: book.id, book, shelf: 0, pos: i })),
        ...framed.slice(0, 2),
      ],
      bottom: [
        ...shelved[1].map((book, i) => ({ kind: 'book', id: book.id, book, shelf: 1, pos: i })),
        ...framed.slice(2),
      ],
    }
  }, [shelved, pxPerMm, wall.h, wall.w, artworks])

  /*
   * Длина досок. Полка не может быть короче того, что на ней стоит, а две
   * полки должны быть одной длины — иначе стена выглядит недостроенной.
   * Поэтому меряем содержимое обеих и берём большее.
   */
  const [boardW, setBoardW] = useState(0)
  useLayoutEffect(() => {
    // Меряем сами вещи, а не строку, в которой они лежат: ширина строки уже
    // зависит от того, что мы ей назначили, и полка запомнила бы своё
    // прошлое состояние вместо настоящей длины содержимого.
    const rows = [topLedgeRef.current, bottomLedgeRef.current].filter(Boolean).map((el) => {
      const row = el.querySelector('.ledge-items')
      const items = [...el.querySelectorAll('.ledge-items > li')]
      if (!row || !items.length) return 0
      const left = row.getBoundingClientRect().left
      return Math.max(...items.map((i) => i.getBoundingClientRect().right)) - left + 12
    })
    if (rows.length) setBoardW(Math.round(Math.max(...rows)))
  }, [ledges, wall.w])

  /*
   * Перестановка работ: тащим раму на другую и меняем их местами. Большая
   * работа стоит на полу отдельно и в обмене не участвует. Расстановка
   * запоминается по именам файлов, поэтому переживает перезагрузку.
   */
  const startArtDrag = (e, slotId) => {
    if (!EDITOR) return
    if (e.button !== undefined && e.button !== 0) return
    artDrag.current = { slotId, x: e.clientX, y: e.clientY, moved: false }
  }

  const moveArtDrag = (e) => {
    const g = artDrag.current
    if (!g) return
    if (!g.moved && Math.abs(e.clientX - g.x) < 5 && Math.abs(e.clientY - g.y) < 5) return
    g.moved = true
    setDragArt({ slotId: g.slotId, dx: e.clientX - g.x, dy: e.clientY - g.y })
  }

  const endArtDrag = async (e) => {
    const g = artDrag.current
    artDrag.current = null
    setDragArt(null)
    if (!g?.moved) return
    const under = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((el) => el.closest?.('[data-slot]'))
      .find((el) => el && el.dataset.slot !== g.slotId)
    if (!under) return
    const names = artworks.small.map((a) => a.name)
    const from = Number(g.slotId)
    const to = Number(under.dataset.slot)
    if (Number.isNaN(from) || Number.isNaN(to)) return
    const next = [...names]
    ;[next[from], next[to]] = [next[to], next[from]]
    const order = next.filter(Boolean)
    await setMeta('artOrder', order)
    const arranged = arrangeArt(artItems.current, order)
    artCache = arranged
    setArtworks(arranged)
  }

  // Правка названия, года и формата с полки: сохраняем и сразу отправляем
  // книжку в папку, чтобы на диске лежало то же, что на экране.
  const saveBook = async (patch) => {
    const book = editing
    setEditing(null)
    if (!book) return
    await updateBook(book.id, patch)
    await load()
    try {
      await syncBook(book.id)
    } catch (err) {
      setNotice(`Не получилось сохранить в папку: ${err.message}`)
    }
  }

  const remove = async (book) => {
    setConfirm(null)
    await deleteBook(book.id)
    load()
  }

  return (
    <div className="shelf-screen">
      <header className="topbar">
        <h1>Скетчбуки</h1>
        {EDITOR &&
          (folder ? (
            <span className="folder-chip">
              <span className="muted small">Папка:</span> {folder.name}
              {folder.state !== 'granted' && (
                <button className="link-btn small" onClick={grantFolder}>
                  разрешить запись
                </button>
              )}
              <button className="link-btn small" onClick={forgetFolder} title="Отвязать папку">
                ×
              </button>
            </span>
          ) : (
            <button className="btn" onClick={chooseFolder}>
              Привязать папку
            </button>
          ))}
        {EDITOR && (
          <button className="btn btn-primary" onClick={() => setDialog(true)}>
            Новый скетчбук
          </button>
        )}
      </header>

      {books === null ? (
        <p className="muted center">Загружаем…</p>
      ) : books.length === 0 ? (
        <div className="empty">
          <p>Полка пока пустая.</p>
          {EDITOR ? (
            <>
              <p className="muted">
                Заведите скетчбук, выберите формат — и собирайте страницы: пустые, сканы, коллажи.
              </p>
              <button className="btn btn-primary" onClick={() => setDialog(true)}>
                Завести первый
              </button>
            </>
          ) : (
            <p className="muted">Скетчбуки ещё не выложены.</p>
          )}
        </div>
      ) : narrow ? (
        <MobileShelf
          books={books}
          summaries={summaries}
          artworks={artworks}
          onOpen={(id) => onOpen(id)}
          onEdit={EDITOR ? setEditing : null}
        />
      ) : (
        <div className="wall" style={{ height: wall.h }} ref={rowRef}>
          {/* колонка пустых рамок справа: ровно по высоте большой работы */}
          <div className="spare-column" style={{ bottom: FLOOR, gap: ledges.spareGap }}>
            {ledges.spare.map((sp) => (
              <span key={sp.id} className="spare-frame">
                <Painting
                  item={{
                    src: null,
                    w: sp.w,
                    h: sp.h,
                    dark: true,
                    hint: `${sp.widthMm}×${sp.heightMm}`,
                  }}
                />
              </span>
            ))}
          </div>

          {/* большая работа слева, стоит на полу и поднимается выше верхней полки */}
          <div className="wall-art" style={{ left: 0, bottom: FLOOR }}>
            <ArtFrame item={ledges.big} />
          </div>

          {[
            { key: 'top', items: ledges.top, bottom: `${TOP_LEDGE * 100}%`, ref: topLedgeRef },
            { key: 'bottom', items: ledges.bottom, bottom: `${FLOOR}px`, ref: bottomLedgeRef },
          ].map((ledge) => (
            <div
              key={ledge.key}
              className="ledge"
              style={{
                bottom: ledge.bottom,
                left: ledges.big.w + 56,
                // полки не доходят до правого края: там висит колонка рамок
                right: Math.max(...ledges.spare.map((s2) => s2.w)) + 64,
                minWidth: boardW || undefined,
              }}
              ref={ledge.ref}
            >
              <ul className={'ledge-items' + (drag ? ' shelf-row-dragging' : '')}>
                {ledge.items.map((it) => {
                  if (it.kind === 'art') {
                    return (
                      <li
                        key={it.id}
                        className={'ledge-art' + (dragArt?.slotId === it.slot ? ' ledge-art-drag' : '')}
                        data-slot={it.slot}
                        style={
                          dragArt?.slotId === it.slot
                            ? { transform: `translate(${dragArt.dx}px, ${dragArt.dy}px)` }
                            : undefined
                        }
                        onPointerDown={(e) => startArtDrag(e, it.slot)}
                        onPointerMove={moveArtDrag}
                        onPointerUp={endArtDrag}
                        onPointerCancel={endArtDrag}
                      >
                        <ArtFrame item={it} />
                      </li>
                    )
                  }
                  const book = it.book
                  const count = summaries[book.id]?.count ?? 0
                  const h = spineHeight(book.heightMm)
                  const w = spineWidth(count)
                  return (
                    <li
                      key={book.id}
                      className={
                        'spine-slot' +
                        (drag?.shelf === it.shelf && drag?.pos === it.pos ? ' spine-slot-drag' : '')
                      }
                      style={slotStyle(it.shelf, it.pos)}
                      onPointerDown={(e) => startDrag(e, it.shelf, it.pos)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      <button
                        className="spine"
                        style={{ height: h, width: w, background: book.coverColor }}
                        onClick={(e) => {
                          if (Date.now() - draggedAt.current < 250) return
                          // отдаём положение корешка: с него начнётся перелёт обложки
                          onOpen(book.id, e.currentTarget.getBoundingClientRect(), book)
                        }}
                        title={`${book.title} · ${book.widthMm}×${book.heightMm} мм · ${pagesLabel(count)}`}
                      >
                        <span className="spine-title" style={{ fontSize: titleSize(w) }}>
                          {book.title}
                        </span>
                        {book.year && (
                          <span className="spine-year">
                            {yearLines(book.year).map((line) => (
                              <span key={line}>{line}</span>
                            ))}
                          </span>
                        )}
                      </button>
                      {EDITOR && (
                        <span
                          className="spine-tool"
                          role="button"
                          tabIndex={0}
                          title="Название, формат, удаление"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(book)
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && setEditing(book)}
                        >
                          ✎
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="ledge-board" />
            </div>
          ))}
        </div>
      )}

      {busy && (
        <div className="toast">
          {busy.label || 'Читаем папку'}… {busy.done} / {busy.total}
        </div>
      )}
      {notice && (
        <button className="toast toast-warn" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}

      {dialog && <NewBookDialog onCancel={() => setDialog(false)} onCreate={create} />}

      {editing && (
        <BookSettings
          book={editing}
          onCancel={() => setEditing(null)}
          onSave={saveBook}
          onDelete={() => {
            const book = editing
            setEditing(null)
            setConfirm(book)
          }}
        />
      )}

      {confirm && (
        <Confirm
          title={`Удалить «${confirm.title}»?`}
          text={
            (summaries[confirm.id]?.count ?? 0) > 0
              ? `Вместе со скетчбуком пропадут его страницы (${summaries[confirm.id].count}).`
              : 'Скетчбук пустой — удаляем без потерь.'
          }
          onCancel={() => setConfirm(null)}
          onConfirm={() => remove(confirm)}
        />
      )}
    </div>
  )
}


/*
 * Полка на телефоне. Стена с рейками рассчитана на то, что работу видно
 * целиком и рядом с ней помещается книжка; на узком экране от этого остаётся
 * только теснота. Поэтому здесь работы идут лентой, а скетчбуки — списком,
 * где сразу читается название, год и первая страница.
 */
function MobileShelf({ books, summaries, artworks, onOpen, onEdit }) {
  const art = [artworks.big, ...(artworks.small || [])].filter((a) => a && a.src)

  return (
    <div className="mobile-wall">
      {art.length > 0 && (
        <div className="mobile-art">
          {art.map((a) => {
            const h = 150
            const ratio = a.aspect || (a.widthMm || 210) / (a.heightMm || 297)
            return (
              <span className="mobile-art-item" key={a.name}>
                <Painting
                  item={{
                    src: a.src,
                    w: Math.round(h * ratio),
                    h,
                    dark: Math.abs((a.widthMm || 0) - (a.heightMm || 0)) < 20,
                  }}
                />
              </span>
            )
          })}
        </div>
      )}

      <ul className="book-cards">
        {books.map((book) => {
          const summary = summaries[book.id] || {}
          const about = [
            book.year || null,
            `${book.widthMm}×${book.heightMm} мм`,
            pagesLabel(summary.count ?? 0),
          ].filter(Boolean)
          return (
            <li key={book.id}>
              <button className="book-card" onClick={() => onOpen(book.id)}>
                <span className="book-card-cover" style={{ background: book.coverColor }}>
                  {summary.cover && <img src={blobUrl(summary.cover)} alt="" loading="lazy" />}
                </span>
                <span className="book-card-text">
                  <span className="book-card-title">{book.title}</span>
                  <span className="muted small">{about.join(' · ')}</span>
                </span>
              </button>
              {onEdit && (
                <button className="link-btn book-card-tool" onClick={() => onEdit(book)}>
                  ✎
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Рама на стене: либо работа, либо пустое место под неё с подсказкой размера.
function ArtFrame({ item }) {
  if (!item) return null
  return (
    <Painting
      item={{
        src: item.art?.src ?? null,
        w: item.w,
        h: item.h,
        dark: item.dark,
        hint: `${item.art?.widthMm ?? ''}×${item.art?.heightMm ?? ''}`,
      }}
    />
  )
}

function pagesLabel(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} страница`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} страницы`
  return `${n} страниц`
}
