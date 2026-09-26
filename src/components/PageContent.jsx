import { memo } from 'react'
import { blobUrl } from '../lib/images.js'
import ItemView from './ItemView.jsx'

/*
 * Содержимое одной страницы: картинки и подписи. Координаты — доли от размера
 * страницы, поэтому страница одинаково выглядит и в развороте, и в ленте
 * миниатюр, и в редакторе: меняется только размер контейнера.
 *
 * thumbs — режим для ленты и обзора: берём уменьшенные копии, иначе сотня
 * страниц заставит браузер декодировать сотню полноразмерных снимков.
 */
function PageContent({ page, number, showNumber = true, side = 'right', thumbs = false, eager = false }) {
  if (!page) return null
  const items = page.items || []
  const pick = (full, small) => (thumbs ? small || full : full)

  return (
    <div className="page-content">
      {page.blob && (
        <img
          className="page-scan"
          src={blobUrl(pick(page.blob, page.thumb))}
          alt=""
          draggable={false}
          decoding="async"
          loading={thumbs && !eager ? 'lazy' : 'eager'}
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
          {it.kind === 'text' ? (
            <TextBlock item={it} />
          ) : (
            <ItemView item={it} thumbs={thumbs} eager={eager} />
          )}
        </div>
      ))}
      {showNumber && number != null && (
        <span className={'page-number page-number-' + side}>{number}</span>
      )}
    </div>
  )
}

/*
 * Подпись на странице. Размер шрифта задан долей высоты страницы и считается
 * в единицах контейнера (cqh), поэтому текст уменьшается вместе со страницей —
 * и в ленте миниатюр читается так же, как в развороте, только мельче.
 */
export function TextBlock({ item, fontSize }) {
  return (
    <p
      className={'page-text page-text-' + (item.font || 'serif')}
      style={{
        // в редакторе кегль приходит в пикселях от измеренной страницы,
        // в остальных местах считается от высоты контейнера
        fontSize: fontSize ? `${fontSize}px` : `${(item.size ?? 0.045) * 100}cqh`,
        textAlign: item.align || 'center',
        color: item.color || '#2a241c',
        fontWeight: item.weight || 400,
        fontStyle: item.italic ? 'italic' : undefined,
        letterSpacing: item.tracking ? `${item.tracking}em` : undefined,
      }}
    >
      {item.text}
    </p>
  )
}

export default memo(PageContent)
