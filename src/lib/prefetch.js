/*
 * Тихая довозка книжки.
 *
 * Листание — это ради чего всё затевалось, а листать можно только то, что уже
 * приехало. Превью страницы весит пару килобайт, поэтому книжку целиком видно
 * смысл привезти сразу: 120 страниц — это 290 КБ, восемь секунд даже на узком
 * канале. Дальше книжка листается как местная.
 *
 * Строго по одной и по порядку: параллельная выкачка отбирает канал у того
 * разворота, который смотрят сейчас, и страницы приезжают вразнобой — ровно то,
 * от чего мы уходим.
 */

const done = new Set() // что уже привезли за эту сессию
let current = null

export function prefetch(urls, onProgress) {
  const job = { stopped: false }
  current?.stop()
  current = { stop: () => (job.stopped = true) }

  const list = urls.filter(Boolean)
  const total = list.length
  let ready = list.filter((u) => done.has(u)).length
  onProgress?.(ready, total)

  ;(async () => {
    for (const url of list) {
      if (job.stopped) return
      if (done.has(url)) continue
      try {
        await fetch(url, { priority: 'low' })
        done.add(url)
      } catch {
        return // нет сети: не мучаем очередь, при следующем заходе довезём
      }
      onProgress?.(++ready, total)
    }
  })()

  return () => current?.stop()
}

export const stopPrefetch = () => current?.stop()
