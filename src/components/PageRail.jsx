import { memo, useEffect, useRef } from 'react'
import PageContent from './PageContent.jsx'

function PageRail({ pages, active, selected, aspect = 1, onPick, onDelete }) {
  const railRef = useRef(null)
  const activeRef = useRef(null)
  const first = active[0]

  useEffect(() => {
    const el = activeRef.current
    if (!el || !railRef.current) return
    const rail = railRef.current
    const left = el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2
    rail.scrollTo({ left, behavior: 'smooth' })
  }, [first])

  return (
    <footer className="rail-bar" data-no-drag onClick={(e) => e.stopPropagation()}>
      <div className="rail" ref={railRef}>
        {pages.map((page, i) => {
          const onSpread = active.includes(i)
          return (
            <button
              key={page.id}
              ref={i === first ? activeRef : null}
              className={
                'rail-thumb' +
                (onSpread ? ' rail-thumb-on' : '') +
                (i === selected ? ' rail-thumb-sel' : '')
              }
              style={{ width: Math.round(56 * aspect) }}
              onClick={() => onPick(i)}
              title={`Страница ${i + 1}`}
            >
              <PageContent page={page} showNumber={false} thumbs />
            </button>
          )
        })}
      </div>
      {onDelete && (
        <button className="link-btn small danger" onClick={onDelete}>
          Удалить страницу {selected + 1}
        </button>
      )}
    </footer>
  )
}

// лента из сотен миниатюр — самая дорогая часть экрана;
// не перерисовываем её из-за прогресса импорта и прочих мелочей
export default memo(PageRail)
