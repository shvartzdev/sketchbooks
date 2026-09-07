import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/*
 * Подготовка витрины: размеры для экрана и сводка полки.
 *
 * В репозитории лежат оригиналы сканов — это архив, и трогать его нельзя.
 * Но отдавать в интернет разворот полноразмерными снимками бессмысленно:
 * на экране они всё равно ужимаются, а на медленном канале страница едет
 * секундами. Поэтому при сборке из каждого скана делаются две копии:
 *
 *   web/<id>.webp    1000 px — то, что видно на развороте и крупно
 *   mini/<id>.webp    220 px — лента страниц, обзор, обложки на телефоне
 *
 * Копии в git не попадают: они выводятся из оригинала и живут только внутри
 * собранного сайта. Оригинал остаётся нужен для PDF.
 *
 * Здесь же собирается index.json — сводка полки, чтобы витрине не приходилось
 * читать все book.json ради названий и числа страниц.
 */

const DATA = path.resolve('public/data')
const WEB = { dir: 'web', side: 1000, quality: 70 }
const MINI = { dir: 'mini', side: 220, quality: 62 }

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

async function folderSize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? await folderSize(full) : (await stat(full)).size
  }
  return total
}

// Копия нужного размера. Уже готовую не переделываем: пересборка сайта
// не должна каждый раз перемалывать сотни снимков заново.
async function derive(source, target, { side, quality }) {
  if (existsSync(target)) return (await stat(target)).size
  const out = await sharp(source)
    .rotate()
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toFile(target)
  return out.size
}

async function deriveBook(slug) {
  const dir = path.join(DATA, slug)
  const images = path.join(dir, 'images')
  if (!existsSync(images)) return { count: 0, bytes: 0 }
  await mkdir(path.join(dir, WEB.dir), { recursive: true })
  await mkdir(path.join(dir, MINI.dir), { recursive: true })

  let count = 0
  let bytes = 0
  for (const name of await readdir(images)) {
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue
    const base = name.replace(/\.[^.]+$/, '')
    const source = path.join(images, name)
    bytes += await derive(source, path.join(dir, WEB.dir, `${base}.webp`), WEB)
    bytes += await derive(source, path.join(dir, MINI.dir, `${base}.webp`), MINI)
    count++
  }
  return { count, bytes }
}

// Работы на стене: та же копия для экрана плюс пропорции. Пропорции нужны
// сразу, иначе рама не знает своей формы, пока не доедет сама картина, —
// и стена стоит пустая.
async function deriveArt() {
  const dir = path.join(DATA, 'art')
  if (!existsSync(dir)) return []
  await mkdir(path.join(dir, WEB.dir), { recursive: true })
  const out = []
  for (const name of (await readdir(dir)).sort()) {
    if (!/\.(jpe?g|png|webp|avif)$/i.test(name)) continue
    const base = name.replace(/\.[^.]+$/, '')
    const target = path.join(dir, WEB.dir, `${base}.webp`)
    await derive(path.join(dir, name), target, { side: 1000, quality: 76 })
    const { width, height } = await sharp(target).metadata()
    out.push({ name, file: `${WEB.dir}/${base}.webp`, w: width, h: height })
  }
  return out
}

async function main() {
  if (!existsSync(DATA)) {
    console.warn('public/data нет — витрина соберётся пустой')
    return
  }
  const books = []
  let derived = 0
  let derivedBytes = 0

  for (const entry of await readdir(DATA, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'art' || entry.name === 'objects') continue
    const manifestPath = path.join(DATA, entry.name, 'book.json')
    if (!existsSync(manifestPath)) continue
    const m = await readJson(manifestPath)
    const pages = m.pages || []
    const first = pages.flatMap((p) => p.items || []).find((it) => it.file)
    const made = await deriveBook(entry.name)
    derived += made.count
    derivedBytes += made.bytes

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
      cover: first ? `${entry.name}/${MINI.dir}/${base(first.file)}.webp` : null,
    })
  }

  books.sort(
    (a, b) => (a.shelf ?? 0) - (b.shelf ?? 0) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt),
  )

  const art = await deriveArt()
  const index = {
    format: 'sketchbook-site/2',
    builtAt: new Date().toISOString(),
    sizes: { web: WEB.dir, mini: MINI.dir },
    books,
    art,
  }
  await writeFile(path.join(DATA, 'index.json'), JSON.stringify(index, null, 2) + '\n')

  const mb = (await folderSize(DATA)) / 1024 / 1024
  console.log(
    `index.json: книжек ${books.length}, страниц ${books.reduce((n, b) => n + b.pages, 0)}, работ ${art.length}`,
  )
  console.log(
    `копии для экрана: ${derived} снимков, ${(derivedBytes / 1048576).toFixed(1)} МБ ` +
      `(вся папка с оригиналами — ${mb.toFixed(1)} МБ)`,
  )
}

const base = (file) => file.split('/').pop().replace(/\.[^.]+$/, '')

main()
