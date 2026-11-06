import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        workflow: fileURLToPath(new URL('./index.html', import.meta.url)),
        scheduler: fileURLToPath(new URL('./scheduler.html', import.meta.url)),
      },
    },
  },
})
