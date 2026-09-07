// Локальное хранилище: IndexedDB. Никакого сервера — всё живёт в браузере.
const DB_NAME = 'sketchbooks'
const DB_VERSION = 2

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' })
      }
      // папка на диске, привязанная к приложению: сюда всё сохраняется само
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' })
        pages.createIndex('bookId', 'bookId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode)
        const result = fn(t.objectStore(store))
        t.oncomplete = () => resolve(result && result.__box ? result.__value : result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      }),
  )
}

function reqValue(request) {
  const box = { __box: true, __value: undefined }
  request.onsuccess = () => {
    box.__value = request.result
  }
  return box
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/* ---------- скетчбуки ---------- */

// Место книжки на стене — полка и позиция на ней; расставляет хозяин.
// У книжек, заведённых до этого, места нет — тогда встают по времени создания.
export async function listBooks() {
  const books = await tx('books', 'readonly', (s) => reqValue(s.getAll()))
  return books.sort(
    (a, b) =>
      (a.shelf ?? 0) - (b.shelf ?? 0) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
  )
}

export async function getBook(id) {
  return tx('books', 'readonly', (s) => reqValue(s.get(id)))
}

export async function createBook({ title, widthMm, heightMm, coverColor, year }) {
  const now = Date.now()
  const book = {
    id: uid(),
    order: now, // новая книжка встаёт в конец полки
    title: title || 'Без названия',
    widthMm,
    heightMm,
    coverColor,
    year: year ?? null, // с какого года рисунки — показывается на корешке
    createdAt: now,
    updatedAt: now,
  }
  await tx('books', 'readwrite', (s) => s.put(book))
  return book
}

export async function updateBook(id, patch) {
  const book = await getBook(id)
  if (!book) return null
  const next = { ...book, ...patch, updatedAt: Date.now() }
  await tx('books', 'readwrite', (s) => s.put(next))
  return next
}

export async function deleteBook(id) {
  const pages = await listPages(id)
  await tx('pages', 'readwrite', (s) => {
    pages.forEach((p) => s.delete(p.id))
  })
  await tx('books', 'readwrite', (s) => s.delete(id))
}

/* ---------- страницы ---------- */

export async function listPages(bookId) {
  const db = await openDB()
  const all = await new Promise((resolve, reject) => {
    const t = db.transaction('pages', 'readonly')
    const req = t.objectStore('pages').index('bookId').getAll(bookId)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return all.sort((a, b) => a.order - b.order)
}

export async function addPages(bookId, items) {
  const existing = await listPages(bookId)
  let order = existing.length ? existing[existing.length - 1].order + 1 : 0
  // Страница — это холст: необязательная подложка (старые сканы во всю страницу)
  // плюс список размещённых изображений, каждое со своими долями от размера страницы.
  const created = items.map((item) => ({
    id: uid(),
    bookId,
    order: order++,
    blob: item.blob ?? null,
    thumb: item.thumb ?? null,
    w: item.w ?? null,
    h: item.h ?? null,
    items: item.items ?? [],
    note: '',
    createdAt: Date.now(),
  }))
  await tx('pages', 'readwrite', (s) => {
    created.forEach((p) => s.put(p))
  })
  await updateBook(bookId, {})
  return created
}

export async function updatePage(id, patch) {
  const page = await tx('pages', 'readonly', (s) => reqValue(s.get(id)))
  if (!page) return null
  const next = { ...page, ...patch }
  await tx('pages', 'readwrite', (s) => s.put(next))
  return next
}

export async function deletePage(id) {
  await tx('pages', 'readwrite', (s) => s.delete(id))
}

// Перестановка страниц: принимает массив id в нужном порядке.
export async function reorderPages(ids) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const t = db.transaction('pages', 'readwrite')
    const store = t.objectStore('pages')
    ids.forEach((id, i) => {
      const get = store.get(id)
      get.onsuccess = () => {
        const page = get.result
        if (page) store.put({ ...page, order: i })
      }
    })
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
  })
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  return { usage, quota }
}

// Лёгкая сводка для полки: сколько страниц и миниатюра обложки — без загрузки всех сканов.
export async function getBookSummary(bookId) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction('pages', 'readonly')
    const index = t.objectStore('pages').index('bookId')
    let count = 0
    let first = null
    const countReq = index.count(bookId)
    countReq.onsuccess = () => {
      count = countReq.result
    }
    const cursorReq = index.openCursor(bookId)
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor) return
      const page = cursor.value
      if (!first || page.order < first.order) first = page
      cursor.continue()
    }
    // обложка полки: миниатюра первой страницы, а если скан уже стал
    // картинкой на странице — берём её миниатюру
    t.oncomplete = () =>
      resolve({ count, cover: first?.thumb || first?.items?.[0]?.thumb || null })
    t.onerror = () => reject(t.error)
  })
}

/* ---------- служебные записи ---------- */

export async function getMeta(key) {
  const row = await tx('meta', 'readonly', (s) => reqValue(s.get(key)))
  return row?.value ?? null
}

export async function setMeta(key, value) {
  await tx('meta', 'readwrite', (s) => s.put({ key, value }))
  return value
}

export async function clearMeta(key) {
  await tx('meta', 'readwrite', (s) => s.delete(key))
}

// Новая расстановка: для каждой книжки её полка и место на ней.
export async function placeBooks(places) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const t = db.transaction('books', 'readwrite')
    const store = t.objectStore('books')
    places.forEach(({ id, shelf, order }) => {
      const get = store.get(id)
      get.onsuccess = () => {
        const book = get.result
        if (book) store.put({ ...book, shelf, order })
      }
    })
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
  })
}

// Есть ли в скетчбуке хоть одно изображение: формат можно менять, пока их нет —
// иначе уже размещённые картинки поехали бы вместе с пропорциями страницы.
export async function bookHasImages(bookId) {
  const pages = await listPages(bookId)
  return pages.some((p) => p.blob || (p.items || []).some((i) => i.blob))
}
