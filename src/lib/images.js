// Подготовка сканов: даунскейл до разумного размера + миниатюра для полки и обзора.
const MAX_FULL = 2400
const MAX_THUMB = 480

async function drawScaled(bitmap, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  return { blob, w, h }
}

const isHeic = (file) =>
  /image\/hei[cf]/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '')

// Chrome не умеет HEIC — снимки с айфона он отказывается декодировать.
// Декодер подтягиваем только когда такой файл действительно попался: он тяжёлый.
async function toDecodable(file) {
  if (!isHeic(file)) return file
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  const blob = Array.isArray(out) ? out[0] : out
  return new File([blob], (file.name || 'photo').replace(/\.hei[cf]$/i, '.jpg'), {
    type: 'image/jpeg',
  })
}

export async function prepareScan(file) {
  if (!file.type.startsWith('image/') && !isHeic(file)) return null
  const source = await toDecodable(file)
  // createImageBitmap сам применяет EXIF-ориентацию — снимки с телефона не лягут боком.
  let bitmap
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(source)
  }
  try {
    const full = await drawScaled(bitmap, MAX_FULL, 0.9)
    const thumb = await drawScaled(bitmap, MAX_THUMB, 0.75)
    return { blob: full.blob, thumb: thumb.blob, w: full.w, h: full.h }
  } finally {
    bitmap.close?.()
  }
}

// Возвращает подготовленные картинки и список того, что не прочиталось:
// молча терять файлы нельзя — иначе кажется, что кнопка не работает.
export async function prepareScans(files, onProgress) {
  const out = []
  const failed = []
  const list = Array.from(files)
  for (let i = 0; i < list.length; i++) {
    const file = list[i]
    try {
      const prepared = await prepareScan(file)
      if (prepared) out.push(prepared)
      else failed.push(file.name || 'файл')
    } catch (err) {
      console.warn('Не удалось прочитать файл', file?.name, err)
      failed.push(file.name || 'файл')
    }
    onProgress?.(i + 1, list.length)
  }
  out.failed = failed
  return out
}

// Кэш object-URL'ов, чтобы не плодить их на каждый рендер.
const urlCache = new WeakMap()

export function blobUrl(blob) {
  if (!blob) return null
  // На витрине вместо блоба лежит адрес файла рядом с сайтом — отдаём как есть.
  if (typeof blob === 'string') return blob
  let url = urlCache.get(blob)
  if (!url) {
    url = URL.createObjectURL(blob)
    urlCache.set(blob, url)
  }
  return url
}

// Миниатюра из готового блоба — нужна при импорте: в папке лежат только оригиналы.
export async function makeThumb(blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const { blob: small } = await drawScaled(bitmap, MAX_THUMB, 0.75)
    return { thumb: small, w: bitmap.width, h: bitmap.height }
  } finally {
    bitmap.close?.()
  }
}
