/*
 * Кадрирование.
 *
 * У картинки на странице есть рамка (x, y, w, h — доли страницы) и кадр
 * (crop.x/y/w/h — доли самого изображения): какая часть картинки видна в рамке.
 * Чтобы изображение не растягивалось, кадр и рамка должны иметь одинаковые
 * пропорции на экране — отсюда всё остальное считается само.
 */

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 }
const MIN_CROP = 0.06

export const getCrop = (item) => item.crop || FULL_CROP

export const imageAspect = (item, fallback = 1) =>
  item.iw && item.ih ? item.iw / item.ih : fallback

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// Высота кадра, при которой картинка в рамке не искажается.
export function deriveCropH(cropW, item, pageAspect, imgAspect) {
  return (cropW * imgAspect * item.h) / (item.w * pageAspect)
}

// Кадр держим внутри картинки: не вылезаем за края и не мельчим.
export function clampCrop(crop, item, pageAspect, imgAspect) {
  let w = clamp(crop.w, MIN_CROP, 1)
  let h = deriveCropH(w, item, pageAspect, imgAspect)
  if (h > 1) {
    w /= h
    h = 1
  }
  return {
    w,
    h,
    x: clamp(crop.x, 0, 1 - w),
    y: clamp(crop.y, 0, 1 - h),
  }
}

// Кадр по умолчанию: самый крупный, что влезает в рамку, по центру картинки.
export function fitCrop(item, pageAspect, imgAspect) {
  return clampCrop({ x: 0, y: 0, w: 1, h: 1 }, item, pageAspect, imgAspect)
}

// Масштаб вокруг центра кадра: k > 1 — приблизить.
export function zoomCrop(crop, k, item, pageAspect, imgAspect) {
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  const next = clampCrop({ ...crop, w: crop.w / k }, item, pageAspect, imgAspect)
  return clampCrop(
    { ...next, x: cx - next.w / 2, y: cy - next.h / 2 },
    item,
    pageAspect,
    imgAspect,
  )
}
