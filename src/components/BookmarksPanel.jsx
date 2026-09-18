import { useEffect, useRef } from 'react'
import { uid } from '../lib/db.js'

// Цвета стикеров: приглушённые, как у бумажных закладок, и различимые рядом.
export const BOOKMARK_COLORS = ['#e8b84a', '#e07a5f', '#86b59c', '#6f9ec8', '#b99ad6']

/*
 * Закладки книжки — список рядом с разворотом. Здесь их заводят на текущую
 * страницу, называют, перекрашивают, переносят и удаляют. Сами стикеры
 * живут на листах, а это пульт к ним.
 */
export default function BookmarksPanel({ bookmarks, pages, current, onChange, onGo, onClose }) {
  const ref = useRef(null)
  const fresh = useRef(null) // только что заведённая: сразу даём её назвать

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-bookmarks-toggle]')) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  useEffect(() => {
    if (!fresh.current) return
    ref.current?.querySelector(`[data-id="${fresh.current}"] input`)?.select()
    fresh.current = null
  })

  const pageNo = (pageId) => pages.findIndex((p) => p.id === pageId) + 1
  const update = (id, patch) => onChange(bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)))

  const add = () => {
    const page = pages[current]
    if (!page) return
    const id = uid()
    fresh.current = id
    onChange([
      ...bookmarks,
      {
        id,
        pageId: page.id,
        title: 'Раздел',
        color: BOOKMARK_COLORS[bookmarks.length % BOOKMARK_COLORS.length],
      },
    ])
  }

  const sorted = [...bookmarks].sort((a, b) => pageNo(a.pageId) - pageNo(b.pageId))

  return (
    <div className="bookmarks-panel" ref={ref}>
      <div className="bookmarks-head">
        <span>Закладки</span>
        <button className="btn btn-primary small-btn" onClick={add} disabled={!pages[current]}>
          + на стр. {current + 1}
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="muted small bookmarks-empty">
          Закладка отмечает начало раздела и торчит из обреза, как стикер. Откройте нужную
          страницу и нажмите «+».
        </p>
      ) : (
        <ul className="bookmarks-list">
          {sorted.map((b) => (
            <li key={b.id} data-id={b.id}>
              <div className="bookmark-row">
                <span className="bookmark-dot" style={{ background: b.color }} />
                <input
                  value={b.title}
                  maxLength={40}
                  onChange={(e) => update(b.id, { title: e.target.value })}
                  onBlur={(e) => !e.target.value.trim() && update(b.id, { title: 'Раздел' })}
                  onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                />
                <button className="link-btn small" onClick={() => onGo(b.pageId)} title="Открыть страницу">
                  стр. {pageNo(b.pageId)}
                </button>
                <button
                  className="link-btn small danger"
                  title="Удалить закладку"
                  onClick={() => onChange(bookmarks.filter((x) => x.id !== b.id))}
                >
                  ×
                </button>
              </div>
              <div className="bookmark-tools">
                {BOOKMARK_COLORS.map((c) => (
                  <button
                    key={c}
                    className={'bookmark-swatch' + (b.color === c ? ' bookmark-swatch-on' : '')}
                    style={{ background: c }}
                    aria-label="Цвет закладки"
                    onClick={() => update(b.id, { color: c })}
                  />
                ))}
                {pages[current] && pages[current].id !== b.pageId && (
                  <button
                    className="link-btn small"
                    onClick={() => update(b.id, { pageId: pages[current].id })}
                    title="Переставить закладку на открытую страницу"
                  >
                    перенести на стр. {current + 1}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
