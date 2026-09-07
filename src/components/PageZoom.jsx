import { useEffect } from 'react'
import PageContent from './PageContent.jsx'

/*
 * Одна страница крупно: на витрине клик по развороту не открывает редактор,
 * а показывает страницу во весь экран. На телефоне это главный способ
 * рассматривать рисунки — разворот там мелкий, а страница занимает всё.
 */
export default function PageZoom({ pages, index, aspect = 1, onMove, onClose }) {
  const page = pages[index]

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onMove(1)
      else if (e.key === 'ArrowLeft') onMove(-1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onMove])

  // смахивание вбок — соседняя страница: на телефоне это привычнее кнопок
  const swipe = { x: 0, on: false }
  const start = (e) => {
    swipe.x = e.clientX
    swipe.on = true
  }
  const end = (e) => {
    if (!swipe.on) return
    swipe.on = false
    const dx = e.clientX - swipe.x
    if (Math.abs(dx) > 60) onMove(dx < 0 ? 1 : -1)
  }

  if (!page) return null

  return (
    <div className="zoom" onClick={onClose} onPointerDown={start} onPointerUp={end}>
      <div
        className="zoom-page"
        style={{ aspectRatio: String(aspect) }}
        onClick={(e) => e.stopPropagation()}
      >
        <PageContent page={page} number={index + 1} />
      </div>
      <div className="zoom-bar" onClick={(e) => e.stopPropagation()}>
        <button className="btn" onClick={() => onMove(-1)} disabled={index === 0}>
          ←
        </button>
        <span className="counter">
          {index + 1} / {pages.length}
        </span>
        <button className="btn" onClick={() => onMove(1)} disabled={index === pages.length - 1}>
          →
        </button>
        <button className="btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
