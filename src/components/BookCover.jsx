import { blobUrl } from '../lib/images.js'

/*
 * Лицо скетчбука. Если хозяйка положила обложку — это её снимок. Если нет,
 * обложка собирается сама: цвет книжки, табличка с названием и годами —
 * как было на корешках.
 *
 * Размер текста идёт от ширины самой обложки (контейнерные единицы), поэтому
 * одна и та же обложка годится и для ленты, и для раскрытой книжки, и для
 * маленького предпросмотра в настройках.
 */
export default function BookCover({ book, image = book?.cover }) {
  const src = blobUrl(image)
  return (
    <span className="book-cover" style={{ background: book.coverColor }}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="cover-plate">
          <span className="cover-title" style={{ fontSize: `${titleSize(book.title)}cqw` }}>
            {book.title}
          </span>
          {book.year && <span className="cover-years">{book.year}</span>}
        </span>
      )}
    </span>
  )
}

// Длинное слово не должно рваться посередине: шрифт уменьшается так, чтобы
// самое длинное слово названия влезло в табличку целиком.
function titleSize(title = '') {
  const longest = Math.max(1, ...title.split(/\s+/).map((w) => w.length))
  return Math.min(8.5, 66 / (longest * 0.62))
}
