import { getBook, listPages } from './db.js'
import { getCrop } from './crop.js'
import { rad } from './geometry.js'
import { slugify } from './exchange.js'

/*
 * Вся книжка одним PDF: страница файла = страница скетчбука, в тех же
 * миллиметрах, что и настоящая книжка.
 *
 * Каждая страница собирается на канве ровно так же, как на экране (рамка,
 * кадр, поворот), и вклеивается в PDF картинкой. Это проще и честнее любых
 * векторных ухищрений: что видно в приложении, то и в файле.
 */

const DPI = 200 // печатное качество без гигантских файлов
const MM_PER_INCH = 25.4

// На витрине вместо блоба лежит адрес файла — тогда сначала забираем файл.
async function loadBitmap(source) {
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Не удалось прочитать ${source}`)
    return createImageBitmap(await res.blob())
  }
  return createImageBitmap(source)
}

// Страница скетчбука на канве нужного разрешения.
async function renderPage(page, book, pxPerMm) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(book.widthMm * pxPerMm)
  canvas.height = Math.round(book.heightMm * pxPerMm)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#f4f1ea'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const { width: W, height: H } = canvas

  // старые страницы держат скан подложкой во всю страницу
  if (page.blob) {
    const bitmap = await loadBitmap(page.blob)
    const scale = Math.min(W / bitmap.width, H / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h)
    bitmap.close?.()
  }

  for (const item of page.items || []) {
    if (item.kind === 'text') {
      drawText(ctx, item, W, H)
      continue
    }
    if (!item.blob) continue
    // в PDF идёт оригинал: на экране хватает уменьшенной копии, а в печать — нет
    const bitmap = await loadBitmap(item.origin || item.blob)
    const c = getCrop(item)
    const fw = item.w * W
    const fh = item.h * H
    ctx.save()
    ctx.translate((item.x + item.w / 2) * W, (item.y + item.h / 2) * H)
    if (item.rot) ctx.rotate(rad(item.rot))
    ctx.drawImage(
      bitmap,
      c.x * bitmap.width,
      c.y * bitmap.height,
      c.w * bitmap.width,
      c.h * bitmap.height,
      -fw / 2,
      -fh / 2,
      fw,
      fh,
    )
    ctx.restore()
    bitmap.close?.()
  }
  return canvas
}

// Книжку можно передать готовой: на витрине она приходит из файлов, а не из базы.
/*
 * Подпись на канве: тот же кегль долей от высоты страницы, тот же перенос по
 * словам и то же выравнивание, что и на экране, — чтобы PDF совпадал с книжкой.
 */
function drawText(ctx, item, W, H) {
  const text = (item.text || '').trim()
  if (!text) return
  const fontPx = (item.size ?? 0.05) * H
  const family = item.font === 'sans' ? 'Helvetica, Arial, sans-serif' : 'Georgia, "Times New Roman", serif'
  ctx.save()
  ctx.font = `${(item.weight || 400) >= 600 ? 600 : 400} ${fontPx}px ${family}`
  ctx.fillStyle = item.color || '#2a241c'
  ctx.textBaseline = 'middle'
  const align = item.align || 'center'
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'

  const fw = item.w * W
  const lines = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const probe = line ? `${line} ${word}` : word
      if (line && ctx.measureText(probe).width > fw) {
        lines.push(line)
        line = word
      } else line = probe
    }
    lines.push(line)
  }

  ctx.translate((item.x + item.w / 2) * W, (item.y + item.h / 2) * H)
  if (item.rot) ctx.rotate(rad(item.rot))
  const lh = fontPx * 1.35
  const x = align === 'left' ? -fw / 2 : align === 'right' ? fw / 2 : 0
  const top = -((lines.length - 1) * lh) / 2
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lh))
  ctx.restore()
}

export async function bookToPdf(bookId, { onProgress, withCover = true, source } = {}) {
  const { jsPDF } = await import('jspdf')
  const [book, pages] = source
    ? [source.book, source.pages]
    : await Promise.all([getBook(bookId), listPages(bookId)])
  if (!pages.length) throw new Error('В скетчбуке нет страниц')

  const format = [book.widthMm, book.heightMm]
  const orientation = book.widthMm > book.heightMm ? 'landscape' : 'portrait'
  const doc = new jsPDF({ unit: 'mm', format, orientation, compress: true })
  const pxPerMm = DPI / MM_PER_INCH

  if (withCover) {
    doc.setFillColor(book.coverColor || '#2f3640')
    doc.rect(0, 0, book.widthMm, book.heightMm, 'F')
    doc.setTextColor('#ffffff')
    doc.setFontSize(book.widthMm / 8)
    doc.text(book.title, book.widthMm / 2, book.heightMm / 2, {
      align: 'center',
      maxWidth: book.widthMm * 0.8,
    })
  }

  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderPage(pages[i], book, pxPerMm)
    const jpeg = canvas.toDataURL('image/jpeg', 0.85)
    if (i > 0 || withCover) doc.addPage(format, orientation)
    doc.addImage(jpeg, 'JPEG', 0, 0, book.widthMm, book.heightMm)
    // канву отпускаем сразу: иначе сотня страниц съест всю память
    canvas.width = 0
    canvas.height = 0
    onProgress?.(i + 1, pages.length)
  }

  const name = `${slugify(book.title)}.pdf`
  return { blob: doc.output('blob'), name, pages: pages.length + (withCover ? 1 : 0) }
}
