import { memo } from 'react'
import { blobUrl } from '../lib/images.js'
import ItemView from './ItemView.jsx'

/*
 * Содержимое одной страницы. Координаты картинок — доли от размера страницы,
 * поэтому страница одинаково выглядит и в развороте, и в ленте миниатюр,
 * и в редакторе: меняется только размер контейнера.
 *
 * thumbs — режим для ленты и обзора: берём уменьшенные копии, иначе сотня
 * страниц заставит браузер декодировать сотню полноразмерных снимков.
 *
 * images=false — страница вообще без картинок. Нужно для дальних листов
 * стопки: браузер выкачивает все запрошенные картинки разом, и на медленном
 * канале десяток дальних страниц отнимает канал у той, которую сейчас смотрят.
 * Тогда разворот приходит последним, а до него мелькают случайные страницы.
 */
function PageContent({ page, number, showNumber = true, side = 'right', thumbs = false, images = true }) {
  if (!page) return null
  const items = images ? page.items || [] : []
  const pick = (full, small) => (thumbs ? small || full : full)

  return (
    <div className="page-content">
      {images && page.blob && (
        <img
          className="page-scan"
          src={blobUrl(pick(page.blob, page.thumb))}
          alt=""
          draggable={false}
          decoding="async"
          loading={thumbs ? 'lazy' : 'eager'}
        />
      )}
      {items.map((it) => (
        <div
          key={it.id}
          className="page-item"
          style={{
            left: `${it.x * 100}%`,
            top: `${it.y * 100}%`,
            width: `${it.w * 100}%`,
            height: `${it.h * 100}%`,
            transform: it.rot ? `rotate(${it.rot}deg)` : undefined,
          }}
        >
          <ItemView item={it} thumbs={thumbs} />
        </div>
      ))}
      {showNumber && number != null && (
        <span className={'page-number page-number-' + side}>{number}</span>
      )}
    </div>
  )
}

export default memo(PageContent)
