import { blobUrl } from '../lib/images.js'
import { getCrop } from '../lib/crop.js'

/*
 * Картинка внутри своей рамки с учётом кадра. Рамку рисует родитель
 * (у неё overflow: hidden), а здесь изображение растягивается так, чтобы
 * в рамку попал ровно выбранный кусок.
 */
export default function ItemView({ item, thumbs = false, onLoad }) {
  const c = getCrop(item)
  return (
    <img
      src={blobUrl(thumbs ? item.thumb || item.blob : item.blob)}
      alt=""
      draggable={false}
      decoding="async"
      loading={thumbs ? 'lazy' : 'eager'}
      onLoad={onLoad}
      style={{
        width: `${100 / c.w}%`,
        height: `${100 / c.h}%`,
        left: `${(-c.x / c.w) * 100}%`,
        top: `${(-c.y / c.h) * 100}%`,
      }}
    />
  )
}
