/*
 * Главные цвета картинки — для размытого фона за обложкой.
 *
 * Берём миниатюру, ужимаем до 32 px, раскладываем пиксели на кучки
 * (k-means) и оставляем три самые заметные. Сама картинка на фоне не нужна:
 * от неё остаются только её краски, и под сильным размытием это читается
 * как «свет от обложки».
 *
 * Считается в браузере, а не при сборке: в мастерской обложки живут
 * в IndexedDB, и так оба режима получают цвета одним путём. Миниатюра
 * крошечная, расчёт занимает миллисекунды.
 */

const cache = new Map()
const SIDE = 32
const K = 5 // кучек больше, чем нужно цветов: из них выбираем самые живые
const KEEP = 3

export function paletteOf(src) {
  if (!src) return Promise.resolve(null)
  if (!cache.has(src)) cache.set(src, extract(src).catch(() => null))
  return cache.get(src)
}

function extract(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SIDE
      canvas.height = SIDE
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, SIDE, SIDE)
      resolve(cluster(ctx.getImageData(0, 0, SIDE, SIDE).data))
    }
    img.onerror = reject
    img.src = src
  })
}

function cluster(data) {
  const px = []
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    px.push([data[i], data[i + 1], data[i + 2]])
  }
  if (!px.length) return null

  // Начальные центры — самый тёмный, самый светлый, самый насыщенный и пара
  // пикселей из разных мест картинки: так кучки сразу расходятся по разным
  // краскам, а не делят между собой один фон бумаги.
  const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b)
  const lum = ([r, g, b]) => r * 0.3 + g * 0.59 + b * 0.11
  let centers = [
    px.reduce((a, p) => (lum(p) < lum(a) ? p : a)),
    px.reduce((a, p) => (lum(p) > lum(a) ? p : a)),
    px.reduce((a, p) => (sat(p) > sat(a) ? p : a)),
    px[Math.floor(px.length / 3)],
    px[Math.floor((px.length * 2) / 3)],
  ].map((c) => [...c])

  let sizes = new Array(K).fill(0)
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0])
    sizes = new Array(K).fill(0)
    for (const p of px) {
      let best = 0
      let bestD = Infinity
      centers.forEach((c, k) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = k
        }
      })
      sums[best][0] += p[0]
      sums[best][1] += p[1]
      sums[best][2] += p[2]
      sizes[best]++
    }
    centers = centers.map((c, k) => (sizes[k] ? sums[k].map((v) => v / sizes[k]) : c))
  }

  // Бумага занимает полстраницы, но фон из неё выходит серым. Поэтому
  // кучка весит не только размером, но и насыщенностью: рисунок на белом
  // листе даёт фону свои краски, а не цвет бумаги.
  return centers
    .map((c, k) => ({ c, w: sizes[k] * (0.12 + sat(c) / 255) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, KEEP)
    .map(({ c }) => tone(c))
}

// Цвет для фона: чуть гуще и без белил — светлое пятно за обложкой
// спорило бы с ней самой.
function tone([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 510
  const k = l > 0.55 ? 0.55 / l : 1
  const mid = (max + min) / 2
  const boost = (v) => Math.round(Math.min(255, Math.max(0, (mid + (v - mid) * 1.25) * k)))
  return `rgb(${boost(r)} ${boost(g)} ${boost(b)})`
}
