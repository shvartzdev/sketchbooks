import { useState } from 'react'
import { blobUrl } from '../lib/images.js'
import { getCrop } from '../lib/crop.js'

/*
 * Картинка внутри своей рамки с учётом кадра. Рамку рисует родитель
 * (у неё overflow: hidden), а здесь изображение растягивается так, чтобы
 * в рамку попал ровно выбранный кусок.
 *
 * Сначала показываем миниатюру, поверх неё проявляется полная. Миниатюра
 * весит пару килобайт и приезжает мгновенно, поэтому страница никогда не
 * стоит пустой — она просто становится резче через секунду.
 */
export default function ItemView({ item, thumbs = false, eager = false, onLoad }) {
  const [sharp, setSharp] = useState(false)
  const c = getCrop(item)
  const style = {
    width: `${100 / c.w}%`,
    height: `${100 / c.h}%`,
    left: `${(-c.x / c.w) * 100}%`,
    top: `${(-c.y / c.h) * 100}%`,
  }
  const small = item.thumb || item.blob
  const full = item.blob

  if (thumbs || !small || small === full) {
    return (
      <img
        src={blobUrl(thumbs ? small : full)}
        alt=""
        draggable={false}
        decoding="async"
        loading={thumbs && !eager ? 'lazy' : 'eager'}
        fetchPriority={thumbs ? 'low' : 'high'}
        onLoad={onLoad}
        style={style}
      />
    )
  }

  return (
    <>
      <img
        src={blobUrl(small)}
        alt=""
        draggable={false}
        decoding="async"
        fetchPriority="high"
        style={style}
      />
      <img
        src={blobUrl(full)}
        alt=""
        draggable={false}
        decoding="async"
        fetchPriority="high"
        onLoad={(e) => {
          setSharp(true)
          onLoad?.(e)
        }}
        style={{ ...style, opacity: sharp ? 1 : 0, transition: 'opacity 0.25s ease-out' }}
      />
    </>
  )
}
