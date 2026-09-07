import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * На GitHub Pages сайт живёт не в корне домена, а по адресу вида
 * /имя-репозитория/, поэтому базовый путь приходит из окружения: локально
 * он не нужен, на сборке его подставляет GitHub Actions.
 */
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { port: 5173 },
  build: { assetsInlineLimit: 0 },
})
