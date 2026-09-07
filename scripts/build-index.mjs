import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/*
 * Сводка витрины: index.json.
 *
 * Полке нужно знать про каждую книжку название, формат, год, место на стене,
 * число страниц и обложку — и не тянуть ради этого все book.json. Поэтому
 * список собирается заранее, при сборке сайта, прямо из папки с содержимым.
 * Скрипт запускается сам перед npm run build, в том числе на GitHub.
 */

const DATA = path.resolve('public/data')

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function folderSize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await folderSize(full)
    else total += (await stat(full)).size
  }
  return total
}

async function main() {
  if (!existsSync(DATA)) {
    console.warn('public/data нет — витрина соберётся пустой')
    return
  }
  const entries = await readdir(DATA, { withFileTypes: true })
  const books = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'art' || entry.name === 'objects') continue
    const manifestPath = path.join(DATA, entry.name, 'book.json')
    if (!existsSync(manifestPath)) continue
    const m = await readJson(manifestPath)
    const pages = m.pages || []
    // обложка полки — миниатюра первой картинки, какая найдётся
    const first = pages.flatMap((p) => p.items || []).find((it) => it.thumb || it.file)
    books.push({
      slug: entry.name,
      title: m.title || entry.name,
      widthMm: m.widthMm,
      heightMm: m.heightMm,
      coverColor: m.coverColor,
      year: m.year ?? null,
      shelf: m.shelf ?? null,
      order: m.order ?? null,
      createdAt: m.createdAt ?? 0,
      pages: pages.length,
      cover: first ? `${entry.name}/${first.thumb || first.file}` : null,
    })
  }

  // тот же порядок, что и на полке дома: полка, потом место на ней
  books.sort(
    (a, b) => (a.shelf ?? 0) - (b.shelf ?? 0) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
  )

  const artDir = path.join(DATA, 'art')
  const art = existsSync(artDir)
    ? (await readdir(artDir)).filter((n) => /\.(jpe?g|png|webp|gif|avif)$/i.test(n)).sort()
    : []

  const index = { format: 'sketchbook-site/1', builtAt: new Date().toISOString(), books, art }
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 2) + '\n')

  const mb = (await folderSize(DATA)) / 1024 / 1024
  console.log(
    `index.json: книжек ${books.length}, страниц ${books.reduce((n, b) => n + b.pages, 0)}, ` +
      `работ ${art.length}, вес папки ${mb.toFixed(1)} МБ`,
  )
  if (mb > 700) console.warn('⚠ Папка тяжелее 700 МБ — GitHub такое уже не любит')
}

main()
