import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

/*
 * Своё хранилище: всё привезённое остаётся в браузере, и второй заход на сайт
 * открывается мгновенно — даже без сети. Нужно только собранному сайту:
 * дома картинки и так лежат на диске.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {}) // не вышло — сайт просто работает как обычно
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
