// Importa arquivos para o banco central pelo terminal, com o MESMO importador do painel (src/lib/importer.ts).
// Útil para arquivos grandes (ZIPs de centenas de MB) que pesam no navegador.
//   Uso (na pasta painel-app):  node scripts/importar.mjs "arquivo1.zip" "arquivo2.csv" ...
//   Arquivos passados juntos entram numa importação só (ex.: CSV de XMLs + arquivo de protocolos).
// Pede o e-mail e a senha do painel (a senha não aparece enquanto você digita e não é gravada).
// Usa o banco de .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
import { createServer } from 'vite'
import { openAsBlob, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import readline from 'node:readline'

const app = resolve(import.meta.dirname, '..')
const arquivos = process.argv.slice(2)
if (!arquivos.length) { console.log('Uso: node scripts/importar.mjs "arquivo.zip" "arquivo.csv" ...'); process.exit(1) }

function perguntar(texto, oculto = false) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (oculto) rl._writeToOutput = s => rl.output.write(s.includes(texto) ? s : '*'.repeat(s.length ? 1 : 0))
    rl.question(texto, r => { rl.close(); if (oculto) process.stdout.write('\n'); res(r.trim()) })
  })
}

// o código do painel espera um navegador
const mem = new Map()
globalThis.window = globalThis
globalThis.location = new URL('http://localhost/')
globalThis.history = { replaceState() {} }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear(),
} })

const server = await createServer({ configFile: false, root: app, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
try {
  const remote = await server.ssrLoadModule('/src/lib/remote.ts')
  if (!remote.remoto) throw new Error('painel-app/.env.local sem VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')
  const { importar } = await server.ssrLoadModule('/src/lib/importer.ts')

  console.log('\n=== Importação NF-e Control (banco central) ===')
  const email = await perguntar('E-mail do painel: ')
  const senha = await perguntar('Senha: ', true)
  if (!email || !senha) throw new Error('e-mail e senha são obrigatórios')
  const { error } = await remote.sb.auth.signInWithPassword({ email, password: senha })
  if (error) throw new Error('login recusado: ' + error.message)

  const files = []
  for (const a of arquivos) files.push(new File([await openAsBlob(a)], basename(a)))
  console.log(`\n${files.length} arquivo(s): ${files.map(f => f.name).join(', ')}`)
  let ult = ''
  const r = await importar(files, m => { if (m !== ult) { ult = m; process.stdout.write('\r  ' + m.padEnd(90).slice(0, 90)) } })
  console.log(`\n\nPronto em ${r.segundos}s: ${r.ok.toLocaleString('pt-BR')} notas em ${r.meses.length} loja/mês, ` +
    `${r.canceladas.toLocaleString('pt-BR')} canceladas registradas, ${r.repetidas.toLocaleString('pt-BR')} repetidas contadas uma vez, ` +
    `${r.ignorados.toLocaleString('pt-BR')} inutilizações/eventos ignorados.`)
  if (r.erros.length) {
    const log = resolve(dirname(resolve(arquivos[0])), `importacao-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}.log`)
    writeFileSync(log, r.erros.join('\r\n'))
    console.log(`${r.erros.length.toLocaleString('pt-BR')} com erro — veja ${log}`)
  }
  await remote.sb.auth.signOut()
} catch (e) {
  console.error('\nERRO: ' + e.message)
  process.exitCode = 1
} finally {
  await server.close()
}
