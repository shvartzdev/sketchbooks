/*
 * Своё хранилище для витрины.
 *
 * GitHub Pages разрешает браузеру помнить файлы всего десять минут, поэтому без
 * этого каждый заход выкачивал бы книжку заново. Правило простое:
 *
 *   data/…  картинки   — навсегда: у каждого снимка неповторимое имя,
 *                        устареть он не может
 *   assets/…           — тоже навсегда: в имени файла отпечаток содержимого
 *   *.json, страница   — сначала сеть: иначе после git push не видно новых
 *                        страниц. Нет сети — отдаём, что лежит.
 */

const CACHE = 'sketchbooks-1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

const forever = (url) =>
  (url.pathname.includes('/data/') && !url.pathname.endsWith('.json')) ||
  url.pathname.includes('/assets/')

async function fromCache(request) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

async function fromNetwork(request) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(request)
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  e.respondWith(forever(url) ? fromCache(e.request) : fromNetwork(e.request))
})
