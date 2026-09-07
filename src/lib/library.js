import { getBook, getBookSummary, listBooks, listPages } from './db.js'
import { readArt } from './folder.js'
import { siteArt, siteBook, siteBooks } from './site.js'
import { VIEWER } from './mode.js'

/*
 * Одна дверь к содержимому для обоих режимов.
 *
 * В мастерской это IndexedDB и папка на диске, на сайте — готовые файлы.
 * Экраны об этом не знают: им приходят те же книжки, страницы и изображения,
 * только у витрины вместо блоба лежит адрес файла.
 */

export async function loadShelf() {
  if (VIEWER) return siteBooks()
  const books = await listBooks()
  const entries = await Promise.all(books.map(async (b) => [b.id, await getBookSummary(b.id)]))
  return { books, summaries: Object.fromEntries(entries) }
}

export async function loadBook(id) {
  if (VIEWER) return siteBook(id)
  const [book, pages] = await Promise.all([getBook(id), listPages(id)])
  return { book, pages }
}

// Пропорции работы узнаём у браузера: и у файла с диска, и у файла с сайта
// это один и тот же вопрос к картинке.
async function withAspect(item) {
  const img = new Image()
  img.src = item.url
  try {
    await img.decode()
  } catch {
    return null // не картинка или не открылась
  }
  return { name: item.name, url: item.url, aspect: img.naturalWidth / img.naturalHeight }
}

export async function loadArtwork() {
  const files = VIEWER
    ? await siteArt()
    : (await readArt()).map((f) => ({ name: f.name, url: URL.createObjectURL(f.file) }))
  const measured = await Promise.all(files.map(withAspect))
  return measured.filter(Boolean)
}
