import { useEffect, useState } from 'react'
import Shelf from './components/Shelf.jsx'
import BookView from './components/BookView.jsx'
import Wall from './components/Wall.jsx'

function readRoute() {
  const m = window.location.hash.match(/^#\/book\/([\w-]+)/)
  if (m) return { name: 'book', id: m[1] }
  if (window.location.hash.startsWith('#/wall')) return { name: 'wall' }
  return { name: 'shelf' }
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [flight, setFlight] = useState(null) // { id, rect } — книжка, которая сейчас раскрывается

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /*
   * Открытие как в Paper: экран не подменяется. Книжка появляется поверх полки
   * ровно на месте корешка, вырастает к зрителю и по дороге распахивается,
   * а полка под ней гаснет. Маршрут меняется уже после — и книжка при этом
   * не пересоздаётся: у неё тот же ключ и то же место в дереве.
   */
  const openBook = (id, rect) => {
    if (rect) setFlight({ id, rect })
    else window.location.hash = `#/book/${id}`
  }

  const landed = () => {
    const id = flight?.id
    setFlight(null)
    if (id && !window.location.hash.includes(id)) window.location.hash = `#/book/${id}`
  }

  const goShelf = () => {
    window.location.hash = '#/'
  }

  const bookId = route.name === 'book' ? route.id : flight?.id

  return (
    <>
      {route.name === 'shelf' && (
        <div className={'screen' + (flight ? ' screen-leaving' : '')}>
          <Shelf onOpen={openBook} />
        </div>
      )}
      {route.name === 'wall' && (
        <div className="screen">
          <Wall onBack={goShelf} onOpenBook={(id) => (window.location.hash = `#/book/${id}`)} />
        </div>
      )}
      {bookId && (
        <BookView
          key={bookId}
          bookId={bookId}
          onBack={goShelf}
          entrance={flight?.rect}
          onEntered={landed}
        />
      )}
    </>
  )
}
