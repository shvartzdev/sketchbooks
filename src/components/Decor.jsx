/*
 * Убранство полок: предметы под холщовыми чехлами и картины между ними.
 *
 * Чехлы рисуются вектором прямо здесь — никаких картинок не нужно, и каждый
 * предмет получается свой: форма, складки и обвязка выводятся из числа-семени.
 * Картины берутся из папки src/art: что туда положили, то и стоит на полке.
 */

// Простой детерминированный генератор: одна и та же полка при каждом заходе.
function rng(seed) {
  let t = seed + 0x6d2b79f5
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ткань светлая, как холст на скульптуре перед открытием
/*
 * Керамические домики на полке: фахверк с крутой двускатной крышей.
 * Рисуются вектором, каждый свой — ширина, скат, число этажей и окон
 * выводятся из числа-семени. Две глазури: светлый камень и зелёная.
 */
const GLAZE = [
  { wall: '#efe9dc', wall2: '#ded6c4', roof: '#e2dacb', roof2: '#c9c0ad', beam: '#c2b8a2', win: '#b9ae97' },
  { wall: '#9fbd77', wall2: '#7d9e58', roof: '#6f8f4c', roof2: '#55703a', beam: '#5d7a3e', win: '#4c6633' },
]

export function House({ item }) {
  const { w, h, seed } = item
  const rand = rng(seed)
  const g = GLAZE[seed % GLAZE.length]
  const id = `house${seed}`

  const roofH = h * (0.36 + rand() * 0.1)
  const over = w * 0.07 // свес крыши
  const floors = 2 + Math.round(rand() * 2)
  const bodyTop = roofH
  const bodyH = h - roofH
  const cols = 2 + Math.round(rand())

  const beams = []
  // горизонтальные балки между этажами
  for (let i = 1; i < floors; i++) {
    const y = bodyTop + (bodyH * i) / floors
    beams.push(<line key={`h${i}`} x1="0" y1={y} x2={w} y2={y} stroke={g.beam} strokeWidth={h * 0.012} />)
  }
  // стойки и раскосы
  for (let c = 1; c < cols + 1; c++) {
    const x = (w * c) / (cols + 1)
    beams.push(<line key={`v${c}`} x1={x} y1={bodyTop} x2={x} y2={h} stroke={g.beam} strokeWidth={h * 0.01} />)
  }
  for (let i = 0; i < floors; i++) {
    if (rand() < 0.45) continue
    const y0 = bodyTop + (bodyH * i) / floors
    const y1 = bodyTop + (bodyH * (i + 1)) / floors
    beams.push(
      <line key={`d${i}`} x1={w * 0.08} y1={y1} x2={w * 0.45} y2={y0} stroke={g.beam} strokeWidth={h * 0.009} />,
    )
  }

  // окна по этажам
  const windows = []
  for (let i = 0; i < floors; i++) {
    const y = bodyTop + (bodyH * (i + 0.28)) / floors
    const wh = (bodyH / floors) * 0.34
    for (let c = 0; c < cols; c++) {
      const x = (w * (c + 0.62)) / (cols + 0.24)
      const ww = w * 0.11
      windows.push(
        <g key={`w${i}-${c}`}>
          <rect x={x} y={y} width={ww} height={wh} rx={w * 0.015} fill={g.win} opacity="0.85" />
          <line
            x1={x + ww / 2}
            y1={y}
            x2={x + ww / 2}
            y2={y + wh}
            stroke={g.wall}
            strokeWidth={h * 0.005}
            opacity="0.7"
          />
        </g>,
      )
    }
  }

  return (
    <svg className="decor-svg" width={w} height={h} viewBox={`${-over} 0 ${w + over * 2} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0.2">
          <stop offset="0" stopColor={g.wall} />
          <stop offset="0.65" stopColor={g.wall} />
          <stop offset="1" stopColor={g.wall2} />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor={g.roof} />
          <stop offset="1" stopColor={g.roof2} />
        </linearGradient>
      </defs>
      <rect x="0" y={bodyTop} width={w} height={bodyH} fill={`url(#${id})`} />
      {beams}
      {windows}
      {/* дверь */}
      <path
        d={`M ${w * 0.42} ${h} L ${w * 0.42} ${h - bodyH * 0.16} Q ${w * 0.5} ${h - bodyH * 0.22} ${w * 0.58} ${h - bodyH * 0.16} L ${w * 0.58} ${h} Z`}
        fill={g.win}
        opacity="0.9"
      />
      {/* крыша со свесом и коньком */}
      <path
        d={`M ${-over} ${roofH} L ${w / 2} 0 L ${w + over} ${roofH} Z`}
        fill={`url(#${id}r)`}
      />
      {/* черепица: пара линий вдоль ската, чтобы крыша не была плоским треугольником */}
      {[0.35, 0.62, 0.85].map((t) => (
        <path
          key={t}
          d={`M ${-over * t + (w / 2) * (1 - t)} ${roofH * t} L ${w / 2 + (w / 2 + over) * t} ${roofH * t}`}
          stroke={g.roof2}
          strokeWidth={h * 0.008}
          opacity="0.5"
        />
      ))}
      <path d={`M ${-over} ${roofH} L ${w + over} ${roofH}`} stroke={g.roof2} strokeWidth={h * 0.014} />
    </svg>
  )
}

// Пара домиков на полку: размеры и вид выводятся из семени.
export function housesFor(seed, count, unit) {
  const rand = rng(seed)
  const out = []
  for (let i = 0; i < count; i++) {
    const h = Math.round(unit * (0.62 + rand() * 0.38))
    out.push({
      id: `house${seed}-${i}`,
      h,
      w: Math.round(h * (0.42 + rand() * 0.16)),
      seed: (seed + i * 613) >>> 0,
    })
  }
  return out
}

/*
 * Рама: тёмный профилированный багет, широкое паспарту, работа внутри.
 * Ширины багета и паспарту считаются от размера работы, чтобы маленькая
 * рамка не выглядела как большая, только уменьшенная.
 */
export function Painting({ item }) {
  // багет и паспарту обычно выводятся из размера рамы, но если раму считали
  // изнутри — от пропорций работы, — берём ровно те поля, под которые она сложена
  const side = Math.min(item.w || item.h, item.h)
  const frame = item.frame ?? Math.max(7, Math.round(side * 0.045))
  const mat = item.mat ?? Math.max(9, Math.round(side * 0.075))

  return (
    <span
      className={'art-frame' + (item.dark ? ' art-frame-dark' : '')}
      style={{
        width: item.w,
        height: item.h,
        transform: item.tilt ? `rotate(${item.tilt}deg)` : undefined,
        '--frame': `${frame}px`,
        '--mat': `${mat}px`,
      }}
    >
      <span className="art-mat">
        {item.src ? (
          <img src={item.src} alt="" draggable={false} />
        ) : (
          <span className="art-hint">{item.hint}</span>
        )}
      </span>
    </span>
  )
}

/*
 * Работы на стене. У каждой свой размер в миллиметрах — он живёт с ней вместе
 * с рамой и паспарту, поэтому при перестановке работа переезжает целиком,
 * а не примеряет чужой формат.
 *
 * Размер берётся из имени файла («naturmort-297x594.jpg»), а если его там нет —
 * подбирается по пропорциям снимка.
 */
const BY_ASPECT = [
  { max: 0.62, widthMm: 297, heightMm: 594 }, // вытянутый вертикальный — большая работа
  { max: 0.88, widthMm: 210, heightMm: 297 }, // вертикальный A4
  { max: 1.2, widthMm: 150, heightMm: 150 }, // квадрат примерно в половину A4
  { max: 99, widthMm: 297, heightMm: 210 }, // горизонтальный A4
]

function sizeOf(item) {
  const m = (item.name || '').match(/(\d{2,4})x(\d{2,4})/i)
  if (m) return { widthMm: Number(m[1]), heightMm: Number(m[2]) }
  const a = item.aspect || 1
  const rule = BY_ASPECT.find((r) => a < r.max)
  return { widthMm: rule.widthMm, heightMm: rule.heightMm }
}

/*
 * Раскладка: одна работа стоит на полу слева (самая крупная или помеченная
 * «big-»), остальные — по местам на полках в сохранённом порядке.
 */
export function arrangeArt(items, order = []) {
  // url приходит из папки, а рисуем мы по src — приводим к одному имени,
  // иначе рамы остаются пустыми при вроде бы загруженных работах
  const withSize = items.map((it) => ({ ...it, src: it.src ?? it.url, ...sizeOf(it) }))
  const bigIdx = withSize.findIndex((i) => /^big[-_]/i.test(i.name || ''))
  const byHeight = [...withSize].sort((a, b) => b.heightMm - a.heightMm)
  const big = bigIdx >= 0 ? withSize[bigIdx] : byHeight[0] || null

  const rest = withSize.filter((i) => i !== big)
  const sorted = [
    ...order.map((name) => rest.find((i) => i.name === name)).filter(Boolean),
    ...rest.filter((i) => !order.includes(i.name)),
  ]
  return { big, small: sorted }
}

// Пустые места, пока работ нет: показываем рамы нужных размеров.
export const EMPTY_ART = {
  big: { name: null, src: null, widthMm: 297, heightMm: 594 },
  small: [
    { name: null, src: null, widthMm: 210, heightMm: 297 },
    { name: null, src: null, widthMm: 150, heightMm: 150 },
    { name: null, src: null, widthMm: 297, heightMm: 210 },
  ],
}
