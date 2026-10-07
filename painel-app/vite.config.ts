import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { renameSync } from 'node:fs'
import { resolve } from 'node:path'

// O build vira um único arquivo: ../Painel/Painel NFC-e.html (abre com duplo clique, sem servidor).
// Na Vercel fica ../Painel/index.html (servido na raiz do site).
// Os dados continuam em ../Painel/dados, gerados pelo Processar.ps1.
const OUT = resolve(import.meta.dirname, '../Painel')
const renomear = (): Plugin => ({
  name: 'renomear-painel',
  apply: 'build',
  enforce: 'post',
  closeBundle: () => process.env.VERCEL ? undefined : renameSync(resolve(OUT, 'index.html'), resolve(OUT, 'Painel NFC-e.html')),
})

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), viteSingleFile(), renomear()],
  base: './',
  publicDir: command === 'serve' ? '../Painel' : false,
  build: { outDir: OUT, emptyOutDir: false, chunkSizeWarningLimit: 2000 },
}))
