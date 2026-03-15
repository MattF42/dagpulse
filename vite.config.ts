import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Default gRPC-web target for the dev-server proxy.
// Override by setting VITE_RPC_HOST in your environment or .env file.
const rpcTarget = process.env.VITE_RPC_HOST || 'http://localhost:4242'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: '/dagpulse/',
  server: {
	  host: '0.0.0.0',
    proxy: {
      // Forward all gRPC-web requests to the local HTND node
      // (or to a grpcwebproxy sidecar if HTND's gRPC-web support is not enabled).
      '/protowire.RPC': {
        target: rpcTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        // @protobufjs/inquire uses eval only to optionally require Node.js
        // modules; this code path is never reached in the browser.
        if (warning.code === 'EVAL' && warning.id?.includes('@protobufjs/inquire')) return
        defaultHandler(warning)
      },
    },
  },
})
