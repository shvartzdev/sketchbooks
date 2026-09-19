/*
 * Год рисунков — подпись, а не дата: это может быть один год или диапазон.
 * Приводим к одному виду («2024» или «2024–2026»), но не запрещаем написать
 * что-то своё: это подпись хозяина, а не поле формы.
 */
export function normalizeYears(input) {
  const raw = (input || '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{4})\s*[–—-]\s*(\d{4})$/)
  if (m) return m[1] === m[2] ? m[1] : `${m[1]}–${m[2]}`
  return raw.replace(/\s*[–—-]\s*/, '–')
}

// Разбиваем на строки: диапазон читается на корешке в две строки.
export function yearLines(year) {
  if (!year) return []
  const parts = String(year).split('–')
  return parts.length === 2 ? [parts[0], `–${parts[1]}`] : [String(year)]
}

// Короткий диапазон для тесного корешка: «2018–2020» → «2018–20».
export function shortYears(year) {
  const m = String(year || '').match(/^(\d{2})(\d{2})–(\d{2})(\d{2})$/)
  return m && m[1] === m[3] ? `${m[1]}${m[2]}–${m[4]}` : String(year)
}
