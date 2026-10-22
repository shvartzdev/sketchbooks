import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearMeta,
  createBook,
  deleteBook,
  forgetSlug,
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
  removeBookFolder,
  supported,
  syncBook,
  unlinkFolder,
} from '../lib/folder.js'
import BookSettings from './BookSettings.jsx'
import { blobUrl } from '../lib/images.js'
import NewBookDialog from './NewBookDialog.jsx'
import { Confirm } from './Dialog.jsx'
import Ribbon from './Ribbon.jsx'

// Загруженные работы переживают уход на книжку и обратно: иначе при возврате
// лента секунду стоит без них и потом дёргается, когда работы придут.
let artCache = null

/*
 * Порядок работ в ленте — по сохранённому списку имён, новые в конце.
 * Расстановка запоминается по именам файлов, поэтому переживает перезагрузку.
 */
function orderArt(items, order = []) {
  const known = order.map((name) => items.find((it) => it.name === name)).filter(Boolean)
  return [...known, ...items.filter((it) => !order.includes(it.name))]
}

export default function Shelf({ onOpen }) {
  const [books, setBooks] = useState(null)
  const [summaries, setSummaries] = useState({})
  const [dialog, setDialog] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [editing, setEditing] = useState(null) // скетчбук, у которого правим название и формат
  const [busy, setBusy] = useState(null)
  const [notice, setNotice] = useState(null)
  const [folder, setFolder] = useState(null) // { name, state }
  const [artworks, setArtworks] = useState(() => artCache || [])
  const [zoom, setZoom] = useState(null) // работа, открытая крупно

  // Работы из подпапки art привязанной папки (на сайте — из сводки):
  // читаем файлы, узнаём пропорции и ставим в ленту за книжками.
  const loadArt = useCallback(async () => {
    const items = await loadArtwork()
    const order = (EDITOR && (await getMeta('artOrder'))) || []
    const arranged = orderArt(items, order)
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
  const pickingUp = useRef(false)
  const pickUpFromFolder = useCallback(async (handle) => {
    // Два чтения папки разом (клик по «разрешить запись» и проверка при
    // загрузке) успевали оба не найти книжку и обе её завести — отсюда
    // дубли на полке. Пускаем по одному.
    if (pickingUp.current) return
    pickingUp.current = true
    try {
      // «Известные» — это и то, что уже на полке, и то, что с полки убрали:
      // удалённое не должно возвращаться из папки само.
      const known = [
        ...(await listBooks()).map((b) => b.slug).filter(Boolean),
        ...((await getMeta('forgotten')) || []),
      ]
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
    } finally {
      pickingUp.current = false
    }
  }, [load])

  useEffect(() => {
    load()
    refreshFolder().then(async () => {
      await loadArt()
      // Папку перечитываем при каждом открытии полки: книжка, появившаяся
      // в ней со стороны (склонировали репозиторий, собрали альбом),
      // должна встать на полку сама, без привязывания папки заново.
      const handle = await getFolder()
      if (handle && (await folderState(handle)) === 'granted') await pickUpFromFolder(handle)
    })
  }, [load, refreshFolder, loadArt, pickUpFromFolder])


  const chooseFolder = async () => {
    if (!supported()) {
      setNotice('Папку на диске умеют Chrome и Edge — в Safari такого API нет')
      return
    }
    try {
      const handle = await linkFolder()
      await clearMeta('forgotten') // новая папка — новый отсчёт
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
   * Перестановка в ленте — стрелками у подписи. Книжки двигаются среди
   * книжек, работы среди работ: работы всегда идут следом за книжками.
   */
  const move = async (entry, dir) => {
    if (entry.kind === 'book') {
      const list = [...books]
      const i = list.findIndex((b) => b.id === entry.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return
      ;[list[i], list[j]] = [list[j], list[i]]
      await placeBooks(list.map((b, order) => ({ id: b.id, shelf: 0, order })))
      await load()
    } else {
      const names = artworks.map((a) => a.name)
      const i = names.indexOf(entry.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= names.length) return
      ;[names[i], names[j]] = [names[j], names[i]]
      await setMeta('artOrder', names)
      const arranged = orderArt(artworks, names)
      artCache = arranged
      setArtworks(arranged)
    }
  }

  // Всё, что стоит в ленте: сначала скетчбуки, за ними работы по одной.
  const items = useMemo(() => {
    const list = books || []
    const bookItems = list.map((book, i) => {
      const summary = summaries[book.id] || {}
      const count = summary.count ?? 0
      return {
        key: `book-${book.id}`,
        kind: 'book',
        id: book.id,
        book,
        title: book.title,
        about: [book.year, `${book.widthMm}×${book.heightMm} мм`, pagesLabel(count)]
          .filter(Boolean)
          .join(' · '),
        aspect: (book.widthMm || 210) / (book.heightMm || 297),
        color: book.coverColor,
        image: book.cover ?? null,
        thumb: blobUrl(book.coverThumb ?? book.cover),
        canMove: (dir) => i + dir >= 0 && i + dir < list.length,
      }
    })
    const artItems = artworks.map((art, i) => ({
      key: `art-${art.name}`,
      kind: 'art',
      id: art.name,
      title: artTitle(art.name),
      about: null,
      aspect: art.aspect || 0.75,
      color: '#1c1f25',
      image: art.src ?? art.url,
      thumb: art.src ?? art.url,
      canMove: (dir) => i + dir >= 0 && i + dir < artworks.length,
    }))
    return [...bookItems, ...artItems]
  }, [books, summaries, artworks])

  const openItem = (item, rect) => {
    if (item.kind === 'book') onOpen(item.id, rect)
    else setZoom(item)
  }

  useEffect(() => {
    if (!zoom) return
    const onKey = (e) => e.key === 'Escape' && setZoom(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

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
    try {
      await removeBookFolder(book.slug)
    } catch (err) {
      // папка осталась на диске — помечаем, чтобы книжка не вернулась с неё сама
      await forgetSlug(book.slug)
      setNotice(`Не получилось удалить папку: ${err.message}`)
    }
    await deleteBook(book.id)
    load()
  }

  return (
    <div className="shelf-screen">
      <header className="topbar topbar-clear">
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
      ) : items.length === 0 ? (
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
      ) : (
        <Ribbon
          items={items}
          onOpen={openItem}
          onEdit={EDITOR ? (item) => setEditing(item.book) : null}
          onMove={EDITOR ? move : null}
          disabled={Boolean(dialog || editing || confirm || zoom)}
        />
      )}

      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)}>
          <img className="art-zoom-img" src={zoom.image} alt="" />
          <div className="zoom-bar" onClick={(e) => e.stopPropagation()}>
            <span className="book-name-static">{zoom.title}</span>
            <button className="btn" onClick={() => setZoom(null)}>
              Закрыть
            </button>
          </div>
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

// Название работы — из имени файла: без размера, служебной приставки и расширения.
function artTitle(name = '') {
  const t = name
    .replace(/\.[^.]+$/, '')
    .replace(/^(big|tall|wide|square)[-_]/i, '')
    .replace(/[-_]?\d{2,4}x\d{2,4}/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return t ? t[0].toUpperCase() + t.slice(1) : 'Работа'
}

function pagesLabel(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} страница`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} страницы`
  return `${n} страниц`
}
