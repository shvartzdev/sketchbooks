/*
 * Немного геометрии для повёрнутых картинок.
 *
 * Координаты картинки — доли страницы: x/w считаются от ширины, y/h от высоты.
 * Поворачивать в таких координатах нельзя: доли по осям «разного масштаба».
 * Поэтому переводим в единицы ширины страницы, крутим там и возвращаем обратно.
 */

export const rad = (deg) => ((deg || 0) * Math.PI) / 180

// Сдвиг курсора (в долях страницы) в систему координат повёрнутой картинки.
export function toLocalDelta(dx, dy, rot, pageAspect) {
  const a = rad(rot)
  const ux = dx
  const uy = dy / pageAspect
  const lx = ux * Math.cos(a) + uy * Math.sin(a)
  const ly = -ux * Math.sin(a) + uy * Math.cos(a)
  return { dx: lx, dy: ly * pageAspect }
}

// Обратный перевод: сдвиг в системе картинки — в доли страницы.
export function toPageDelta(dx, dy, rot, pageAspect) {
  const a = rad(rot)
  const ux = dx
  const uy = dy / pageAspect
  const px = ux * Math.cos(a) - uy * Math.sin(a)
  const py = ux * Math.sin(a) + uy * Math.cos(a)
  return { dx: px, dy: py * pageAspect }
}

// Угол от центра рамки к точке (0° — вверх), с учётом пропорций страницы.
export function angleTo(cx, cy, px, py, pageAspect) {
  const vx = px - cx
  const vy = (py - cy) / pageAspect
  return (Math.atan2(vx, -vy) * 180) / Math.PI
}

export const normalizeAngle = (deg) => ((deg % 360) + 360) % 360
