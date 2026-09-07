import { memo } from 'react'
import PageContent from './PageContent.jsx'

function Overview({ pages, current, onPick, aspect = 1 }) {
  return (
    <div className="overview">
      {pages.map((page, i) => (
        <button
          key={page.id}
          className={'overview-item' + (i === current ? ' overview-item-on' : '')}
          style={{ aspectRatio: String(aspect) }}
          onClick={() => onPick(i)}
        >
          <PageContent page={page} showNumber={false} thumbs />
          <span className="overview-num">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

export default memo(Overview)
