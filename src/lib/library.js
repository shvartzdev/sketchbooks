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

/*
 * Пропорции работы узнаём у браузера: и у файла с диска, и у файла с сайта
 * это один и тот же вопрос к картинке.
 *
 * Спрашиваем через onload, а не через decode(): вкладка в фоне (свёрнутый
 * браузер, соседняя вкладка на телефоне) картинки не декодирует, и decode()
 * там просто не возвращается — стена осталась бы без работ.
 */
function withAspect(item) {
  // на витрине пропорции уже посчитаны при сборке — спрашивать некого
  if (item.aspect) return Promise.resolve(item)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () =>
      resolve({ name: item.name, url: item.url, aspect: img.naturalWidth / img.naturalHeight })
    img.onerror = () => resolve(null) // не картинка или не открылась
    img.src = item.url
  })
}

export async function loadArtwork() {
  const files = VIEWER
    ? await siteArt()
    : (await readArt()).map((f) => ({ name: f.name, url: URL.createObjectURL(f.file) }))
  const measured = await Promise.all(files.map(withAspect))
  return measured.filter(Boolean)
}
