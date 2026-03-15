import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: '/dagpulse/',
  server: {
    host: '0.0.0.0',
    proxy: {
      // Forward WebSocket connections to the local DAGPulse bridge
      '/dagpulse/ws': {
        target: 'ws://localhost:8765',
        ws: true,
        rewrite: (path) => path.replace(/^\/dagpulse\/ws/, '/ws'),
      },
    },
  },
})
