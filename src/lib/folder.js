import { clearMeta, getMeta, setMeta } from './db.js'
import { exportBook } from './exchange.js'

/*
 * Папка на диске как хранилище.
 *
 * Один раз выбираем папку (обычно — папку репозитория), браузер даёт на неё
 * права и умеет запомнить сам handle: он кладётся в IndexedDB и переживает
 * перезапуск. Права при этом не переживают — в начале каждой сессии браузер
 * спросит разрешение заново, по клику. Дальше всё пишется само.
 *
 * Chrome и Edge умеют, Safari и Firefox — нет.
 */

const KEY = 'folder'

export const supported = () => typeof window.showDirectoryPicker === 'function'

export async function getFolder() {
  return getMeta(KEY)
}

// 'granted' — можно писать, 'prompt' — нужен клик, 'denied' — отказано, null — папки нет
export async function folderState(handle) {
  if (!handle) return null
  if (!handle.queryPermission) return 'granted'
  return handle.queryPermission({ mode: 'readwrite' })
}

export async function askPermission(handle) {
  if (!handle?.requestPermission) return 'granted'
  return handle.requestPermission({ mode: 'readwrite' })
}

export async function linkFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'sketchbooks' })
  await setMeta(KEY, handle)
  return handle
}

export async function unlinkFolder() {
  await clearMeta(KEY)
}

// Сохранить книжку в привязанную папку. Молча ничего не делает, если папки нет
// или права ещё не выданы: автосохранение не должно дёргать диалогами.
export async function syncBook(bookId) {
  const handle = await getFolder()
  if (!handle) return null
  if ((await folderState(handle)) !== 'granted') return { pending: true }
  return exportBook(bookId, handle)
}

/*
 * Картинки рядом со скетчбуками: работы в подпапке art, вырезанные предметы
 * в подпапке objects. Так всё едет в git вместе и не требует лазить в исходники.
 */
async function readImagesFrom(name) {
  const handle = await getFolder()
  if (!handle) return []
  if ((await folderState(handle)) !== 'granted') return []
  let dir
  try {
    dir = await handle.getDirectoryHandle(name)
  } catch {
    return [] // папки ещё нет — это нормально
  }
  const out = []
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue
    if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(entry.name)) continue
    out.push({ name: entry.name, file: await entry.getFile() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export const readArt = () => readImagesFrom('art')
export const readObjects = () => readImagesFrom('objects')
