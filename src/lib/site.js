import { dataUrl } from './mode.js'

/*
 * Чтение витрины: index.json со сводкой полки и book.json на каждую книжку.
 *
 * Картинки не грузятся в память — вместо блоба у изображения лежит обычный
 * адрес файла, и браузер сам решает, когда его тянуть. Поэтому телефон
 * открывает полку мгновенно, а страницы подтягиваются по мере листания.
 */

let indexPromise = null

export function siteIndex() {
  if (!indexPromise) {
    indexPromise = fetch(dataUrl('index.json'))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => json || { books: [], art: [] })
  }
  return indexPromise
}

// Книжки для полки: всё нужное уже посчитано при сборке, лишних запросов нет.
export async function siteBooks() {
  const index = await siteIndex()
  const books = (index.books || []).map((b) => ({
    id: b.slug,
    slug: b.slug,
    title: b.title,
    widthMm: b.widthMm,
    heightMm: b.heightMm,
    coverColor: b.coverColor,
    year: b.year ?? null,
    shelf: b.shelf ?? null,
    order: b.order ?? null,
    createdAt: b.createdAt ?? 0,
  }))
  const summaries = Object.fromEntries(
    (index.books || []).map((b) => [
      b.slug,
      { count: b.pages || 0, cover: b.cover ? dataUrl(b.cover) : null },
    ]),
  )
  return { books, summaries }
}

const cache = new Map()

// Имя файла без пути и расширения: копии для экрана лежат рядом под тем же
// именем, но в webp — так их не приходится перечислять в book.json.
const stem = (file) => file.split('/').pop().replace(/\.[^.]+$/, '')

// Одна книжка: описание и страницы с адресами картинок.
export function siteBook(slug) {
  if (cache.has(slug)) return cache.get(slug)
  const promise = (async () => {
    const [index, res] = await Promise.all([siteIndex(), fetch(dataUrl(`${slug}/book.json`))])
    if (!res.ok) throw new Error(`Нет файла ${slug}/book.json`)
    const manifest = await res.json()
    const sizes = index.sizes
    const book = {
      id: slug,
      slug,
      title: manifest.title,
      widthMm: manifest.widthMm,
      heightMm: manifest.heightMm,
      coverColor: manifest.coverColor,
      year: manifest.year ?? null,
    }
    const pages = (manifest.pages || []).map((page, i) => ({
      id: page.id || `${slug}-${i}`,
      order: i,
      blob: null,
      thumb: null,
      items: (page.items || []).map((it) => {
        const origin = dataUrl(`${slug}/${it.file}`)
        return {
          ...it,
          // вместо блоба — адрес: дальше он проходит везде, где раньше был блоб.
          // На экран идёт копия поменьше, оригинал остаётся для PDF.
          blob: sizes?.web ? dataUrl(`${slug}/${sizes.web}/${stem(it.file)}.webp`) : origin,
          thumb: sizes?.mini
            ? dataUrl(`${slug}/${sizes.mini}/${stem(it.file)}.webp`)
            : dataUrl(`${slug}/${it.thumb || it.file}`),
          origin,
        }
      }),
    }))
    return { book, pages }
  })()
  cache.set(slug, promise)
  return promise
}

/*
 * Работы на стене. Пропорции посчитаны при сборке и лежат прямо здесь:
 * иначе рама не знает своей формы, пока не доедет сама картина, и стена
 * стоит с пустыми местами — на медленном канале это полминуты.
 */
export async function siteArt() {
  const index = await siteIndex()
  return (index.art || []).map((art) =>
    typeof art === 'string'
      ? { name: art, url: dataUrl(`art/${art}`) } // сводка старого образца
      : {
          name: art.name,
          url: dataUrl(`art/${art.file || art.name}`),
          aspect: art.w && art.h ? art.w / art.h : undefined,
        },
  )
}
