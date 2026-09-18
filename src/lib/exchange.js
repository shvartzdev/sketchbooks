import { addPages, createBook, getBook, listPages, updateBook } from './db.js'
import { makeThumb } from './images.js'
import { getCrop } from './crop.js'

/*
 * Обмен с обычной папкой на диске.
 *
 * Скетчбук раскладывается так:
 *   <папка>/<slug>/book.json      — описание: формат, страницы, рамки, кадры, повороты
 *   <папка>/<slug>/images/*.jpg   — сами картинки, по файлу на изображение
 *
 * Смысл в том, чтобы папку можно было положить в git: book.json — текст,
 * он нормально диффится, а картинки пишутся один раз и больше не переписываются
 * (кадрирование и поворот живут числами в book.json, не в пикселях).
 */

export const FORMAT = 'sketchbook/1'
export const canUseFolders = () => typeof window.showDirectoryPicker === 'function'

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

export function slugify(title) {
  const latin = (title || '')
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
  const slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'sketchbook'
}

// Старые страницы держат скан подложкой — на экспорте показываем его обычной картинкой.
function itemsOf(page) {
  if (page.items?.length) return page.items
  if (page.blob) {
    return [
      {
        id: page.id,
        blob: page.blob,
        thumb: page.thumb,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        rot: 0,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        iw: page.w,
        ih: page.h,
      },
    ]
  }
  return []
}

async function writeFile(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

async function readJson(dir, name) {
  const handle = await dir.getFileHandle(name)
  const file = await handle.getFile()
  return JSON.parse(await file.text())
}

/* ---------- экспорт ---------- */

// Картинки неизменяемы: файл именуется по id изображения, а правки живут
// числами в book.json. Поэтому повторная запись — это только новые файлы,
// обновлённый book.json и уборка того, на что больше никто не ссылается.
export async function exportBook(bookId, dirHandle, onProgress) {
  const [book, pages] = await Promise.all([getBook(bookId), listPages(bookId)])
  // имя папки закрепляем за книжкой навсегда: переименование не должно
  // переносить всё в новую папку и городить в git переезд файлов
  const slug = book.slug || `${slugify(book.title)}-${book.id.slice(0, 4)}`
  if (!book.slug) await updateBook(bookId, { slug })
  const bookDir = await dirHandle.getDirectoryHandle(slug, { create: true })
  const imagesDir = await bookDir.getDirectoryHandle('images', { create: true })
  // Миниатюры лежат файлами рядом: на сайте их неоткуда взять на лету, а
  // листать сотню страниц полноразмерными снимками телефон не станет.
  const thumbsDir = await bookDir.getDirectoryHandle('thumbs', { create: true })

  const total = pages.reduce((n, p) => n + itemsOf(p).length, 0)
  let done = 0

  const manifest = {
    format: FORMAT,
    title: book.title,
    widthMm: book.widthMm,
    heightMm: book.heightMm,
    coverColor: book.coverColor,
    year: book.year ?? null,
    // место на стене едет вместе с книжкой: сайт расставляет полку так же,
    // как она стоит дома
    shelf: book.shelf ?? null,
    order: book.order ?? null,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    pages: [],
  }

  for (const page of pages) {
    const items = []
    for (const it of itemsOf(page)) {
      const file = `${it.id}.jpg`
      if (it.blob && !(await fileExists(imagesDir, file))) {
        await writeFile(imagesDir, file, it.blob)
      }
      if (it.thumb && !(await fileExists(thumbsDir, file))) {
        await writeFile(thumbsDir, file, it.thumb)
      }
      const c = getCrop(it)
      items.push({
        id: it.id,
        file: `images/${file}`,
        thumb: it.thumb ? `thumbs/${file}` : null,
        x: round(it.x),
        y: round(it.y),
        w: round(it.w),
        h: round(it.h),
        rot: round(it.rot || 0, 1),
        crop: { x: round(c.x), y: round(c.y), w: round(c.w), h: round(c.h) },
        iw: it.iw ?? null,
        ih: it.ih ?? null,
      })
      onProgress?.(++done, total)
    }
    manifest.pages.push({ id: page.id, items })
  }

  // Закладки держатся за страницу, а в файле страница — это её место в списке:
  // при переносе на другую машину у страниц будут новые id, а порядок тот же.
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]))
  manifest.bookmarks = (book.bookmarks || [])
    .filter((b) => pageIndex.has(b.pageId))
    .map((b) => ({ id: b.id, title: b.title, color: b.color, page: pageIndex.get(b.pageId) }))

  await writeFile(
    bookDir,
    'book.json',
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  )

  // подчищаем картинки удалённых страниц, чтобы репозиторий не пух
  const used = new Set(manifest.pages.flatMap((p) => p.items.map((i) => `${i.id}.jpg`)))
  let removed = 0
  for (const dir of [imagesDir, thumbsDir]) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && !used.has(entry.name)) {
        await dir.removeEntry(entry.name)
        removed++
      }
    }
  }

  return { slug, pages: pages.length, images: total, removed }
}

const round = (v, digits = 5) => Number((v ?? 0).toFixed(digits))

/* ---------- импорт ---------- */

// Принимаем и папку одного скетчбука, и папку, в которой их несколько.
async function findBookDirs(dirHandle) {
  const found = []
  try {
    await dirHandle.getFileHandle('book.json')
    return [dirHandle]
  } catch {
    // пойдём смотреть вложенные папки
  }
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'directory') continue
    try {
      await entry.getFileHandle('book.json')
      found.push(entry)
    } catch {
      // не скетчбук — пропускаем
    }
  }
  return found
}

async function importOne(bookDir, onProgress) {
  const manifest = await readJson(bookDir, 'book.json')
  if (manifest.format !== FORMAT) {
    throw new Error(`Незнакомый формат: ${manifest.format || 'не указан'}`)
  }
  const imagesDir = await bookDir.getDirectoryHandle('images')
  const book = await createBook({
    title: manifest.title || bookDir.name,
    widthMm: manifest.widthMm,
    heightMm: manifest.heightMm,
    coverColor: manifest.coverColor,
    year: manifest.year ?? null,
  })

  const total = manifest.pages.reduce((n, p) => n + (p.items?.length || 0), 0)
  let done = 0
  const pages = []

  for (const page of manifest.pages) {
    const items = []
    for (const entry of page.items || []) {
      const name = entry.file.split('/').pop()
      const blob = await (await imagesDir.getFileHandle(name)).getFile()
      const { thumb, w, h } = await makeThumb(blob)
      items.push({
        id: entry.id,
        blob,
        thumb,
        x: entry.x,
        y: entry.y,
        w: entry.w,
        h: entry.h,
        rot: entry.rot || 0,
        crop: entry.crop,
        iw: entry.iw ?? w,
        ih: entry.ih ?? h,
      })
      onProgress?.(++done, total)
    }
    pages.push({ items })
  }

  const created = await addPages(book.id, pages)
  // место на полке приезжает вместе с книжкой: после git clone стена
  // собирается ровно такой, какой её оставили
  await updateBook(book.id, {
    bookmarks: (manifest.bookmarks || [])
      .filter((b) => created[b.page])
      .map((b) => ({ id: b.id, title: b.title, color: b.color, pageId: created[b.page].id })),
    slug: bookDir.name,
    shelf: manifest.shelf ?? undefined,
    order: manifest.order ?? undefined,
  })
  return { id: book.id, title: book.title, pages: pages.length }
}

export async function importBooks(dirHandle, onProgress) {
  const dirs = await findBookDirs(dirHandle)
  if (!dirs.length) throw new Error('В папке нет book.json — это не выгрузка скетчбука')
  const imported = []
  for (const dir of dirs) imported.push(await importOne(dir, onProgress))
  return imported
}

// Подхватить из папки то, чего нет в браузере: так после git clone на другой
// машине скетчбуки появляются на полке сами, без всяких кнопок «импорт».
export async function importMissing(dirHandle, knownSlugs, onProgress) {
  const dirs = await findBookDirs(dirHandle)
  const fresh = dirs.filter((d) => !knownSlugs.includes(d.name))
  const imported = []
  for (const dir of fresh) imported.push(await importOne(dir, onProgress))
  return imported
}
