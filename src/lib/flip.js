import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Движок листания.
 *
 * Позиция — вещественное число: 2.4 значит «лист №2 перевёрнут на 40%».
 *
 * Жест устроен как шаттл. Пока тянешь, работают две вещи сразу:
 *   1) прямое ведение — позиция идёт за курсором, один лист на strideRef пикселей;
 *   2) непрерывная прокрутка — если увести курсор дальше порога и держать,
 *      листы продолжают идти сами, тем быстрее, чем дальше уведён курсор.
 * Так одним движением можно пролистать хоть весь скетчбук, не отпуская кнопку.
 * После отпускания пружина докручивает до ближайшего целого листа.
 */

// Пружина листа. Жёсткость задаёт скорость, затухание — характер прихода:
// держим его чуть выше критического (2·√жёсткости ≈ 22.8), чтобы страница
// мягко доезжала до места и не подрагивала в конце.
const STIFFNESS = 130
const DAMPING = 23
const VELOCITY_PROJECTION = 0.16 // сколько листов вперёд добавляет скорость броска
const MAX_FLICK = 25
const EDGE_RUBBER = 0.32
const SETTLE_POS = 0.002
const SETTLE_VEL = 0.03
const SHUTTLE_START = 0.28 // доля половины сцены, после которой включается непрерывная прокрутка
const SHUTTLE_MAX_RATE = 13 // листов в секунду на краю сцены

export function useFlipper({ count, strideRef, onFrame }) {
  const pos = useRef(0)
  const vel = useRef(0)
  const target = useRef(0)
  const dragging = useRef(false)
  const raf = useRef(0)
  const lastTime = useRef(0)
  const gesture = useRef(null)
  const dragEndedAt = useRef(0)
  const [index, setIndex] = useState(0)
  const frameCb = useRef(onFrame)
  frameCb.current = onFrame

  const maxPos = Math.max(0, count - 1)
  const maxPosRef = useRef(maxPos)
  maxPosRef.current = maxPos

  const emit = useCallback(() => {
    frameCb.current?.(pos.current, dragging.current)
    const rounded = Math.round(pos.current)
    setIndex((prev) => (prev === rounded ? prev : Math.min(maxPosRef.current, Math.max(0, rounded))))
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = 0
  }, [])

  const tick = useCallback(
    (time) => {
      const dt = Math.min(0.032, (time - lastTime.current) / 1000 || 0.016)
      lastTime.current = time

      const dist = target.current - pos.current
      const accel = dist * STIFFNESS - vel.current * DAMPING
      vel.current += accel * dt
      pos.current += vel.current * dt

      if (Math.abs(target.current - pos.current) < SETTLE_POS && Math.abs(vel.current) < SETTLE_VEL) {
        pos.current = target.current
        vel.current = 0
        emit()
        raf.current = 0
        return
      }
      emit()
      raf.current = requestAnimationFrame(tick)
    },
    [emit],
  )

  const animate = useCallback(() => {
    if (raf.current) return
    lastTime.current = performance.now()
    raf.current = requestAnimationFrame(tick)
  }, [tick])

  const goTo = useCallback(
    (next, { instant = false } = {}) => {
      const clamped = Math.min(maxPosRef.current, Math.max(0, next))
      target.current = clamped
      if (instant) {
        stop()
        pos.current = clamped
        vel.current = 0
        emit()
        return
      }
      animate()
    },
    [animate, emit, stop],
  )

  const step = useCallback((delta) => goTo(Math.round(target.current) + delta), [goTo])

  // Резинка на краях: за пределами книжки тянется втрое тяжелее.
  const clampDrag = useCallback((raw) => {
    const max = maxPosRef.current
    if (raw < 0) return raw * EDGE_RUBBER
    if (raw > max) return max + (raw - max) * EDGE_RUBBER
    return raw
  }, [])

  /* ---------- жест ---------- */

  const dragFrame = useCallback(
    (time) => {
      const g = gesture.current
      if (!g) return
      const dt = Math.min(0.032, (time - g.lastFrame) / 1000 || 0.016)
      g.lastFrame = time

      const dx = g.x - g.startX
      const half = Math.max(120, g.span / 2)
      const threshold = half * SHUTTLE_START
      const away = Math.abs(dx)
      if (away > threshold) {
        const k = Math.min(1, (away - threshold) / (half - threshold))
        g.drift += -Math.sign(dx) * Math.pow(k, 1.7) * SHUTTLE_MAX_RATE * dt
      }

      const next = clampDrag(g.startPos - dx / g.stride + g.drift)
      vel.current = vel.current * 0.72 + ((next - pos.current) / dt) * 0.28
      pos.current = next
      emit()
      g.raf = requestAnimationFrame(dragFrame)
    },
    [clampDrag, emit],
  )

  const onPointerDown = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return
      if (e.target.closest?.('[data-no-drag]')) return
      stop()
      vel.current = 0
      const rect = e.currentTarget.getBoundingClientRect()
      gesture.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        startPos: pos.current,
        stride: strideRef.current || 1,
        span: rect.width,
        drift: 0,
        moved: false,
        axisLocked: null,
        lastFrame: performance.now(),
        raf: 0,
      }
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } catch {
        // некоторые окружения не дают захват — жест переживёт
      }
    },
    [stop, strideRef],
  )

  const onPointerMove = useCallback(
    (e) => {
      const g = gesture.current
      if (!g || g.id !== e.pointerId) return
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY

      if (g.axisLocked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        g.axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
        if (g.axisLocked === 'y') {
          // вертикальный жест — не наш, отдаём странице
          gesture.current = null
          return
        }
        // начинаем крутить только когда стало ясно, что жест горизонтальный
        g.moved = true
        dragging.current = true
        g.lastFrame = performance.now()
        g.raf = requestAnimationFrame(dragFrame)
      }
      g.x = e.clientX
    },
    [dragFrame],
  )

  const endGesture = useCallback(
    (e) => {
      const g = gesture.current
      if (!g || (e && g.id !== e.pointerId)) return
      gesture.current = null
      cancelAnimationFrame(g.raf)
      dragging.current = false
      if (!g.moved) return
      dragEndedAt.current = performance.now()
      const projected = pos.current + vel.current * VELOCITY_PROJECTION
      const wanted = Math.round(projected)
      const base = Math.round(pos.current)
      goTo(Math.max(base - MAX_FLICK, Math.min(base + MAX_FLICK, wanted)))
    },
    [goTo],
  )

  // Трекпад: горизонтальная прокрутка листает, накопитель гасит дробные дельты.
  const wheelAcc = useRef(0)
  const wheelIdle = useRef(0)
  const onWheel = useCallback(
    (e) => {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0
      if (!dx) return
      e.preventDefault()
      wheelAcc.current += dx
      clearTimeout(wheelIdle.current)
      wheelIdle.current = setTimeout(() => {
        wheelAcc.current = 0
      }, 160)
      if (Math.abs(wheelAcc.current) >= 90) {
        step(wheelAcc.current > 0 ? 1 : -1)
        wheelAcc.current = 0
      }
    },
    [step],
  )

  useEffect(() => {
    if (pos.current > maxPos) goTo(maxPos, { instant: true })
    else emit()
  }, [count, maxPos, goTo, emit])

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      if (gesture.current) cancelAnimationFrame(gesture.current.raf)
    },
    [],
  )

  // true, если только что листали: клик сразу после свайпа игнорируем
  const wasDragged = useCallback(() => performance.now() - dragEndedAt.current < 250, [])

  return {
    index,
    posRef: pos,
    wasDragged,
    goTo,
    step,
    onWheel,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
    },
  }
}
