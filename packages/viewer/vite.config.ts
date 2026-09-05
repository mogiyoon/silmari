// Builds one HTML file. sil view serves this single file or embeds the IR into it.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 1e9 },
  // Dev server: everything the viewer asks the sil view server for goes to port 4141, so editing and layout saving work without a build
  server: { proxy: Object.fromEntries(['/graph', '/layout', '/file', '/body', '/bodies'].map((p) => [p, 'http://localhost:4141'])) },
})
