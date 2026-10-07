// Copia o NF-e Control de um projeto Supabase para outro, sem reimportar os CSVs.
//   Uso (na pasta do projeto):  node scripts/migrar-banco.mjs
// Copia: notas (nfce_notas), XMLs (nfce_xml), apelidos das lojas (nfce_lojas) e os usuários.
// Pode ser interrompido e rodado de novo: o que já foi copiado é pulado. Nada é apagado no banco antigo.
// As chaves secret são pedidas na tela (não aparecem enquanto você digita) e não são gravadas em lugar nenhum.
import { createClient } from '@supabase/supabase-js'
import readline from 'node:readline'

const ANTIGO = 'https://uxnhimzhgmjyqesbxjzh.supabase.co'
const NOVO = 'https://gbtzkicppeebnzctktne.supabase.co'

function perguntar(texto, oculto = false) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (oculto) rl._writeToOutput = s => rl.output.write(s.includes(texto) ? s : '*'.repeat(s.length ? 1 : 0))
    rl.question(texto, r => { rl.close(); if (oculto) process.stdout.write('\n'); res(r.trim()) })
  })
}
const fmt = n => n.toLocaleString('pt-BR')
const falhou = (e, onde) => { if (e) throw new Error(`${onde}: ${e.message}`) }

async function todosUsuarios(c) {
  const lista = []
  for (let page = 1; ; page++) {
    const { data, error } = await c.auth.admin.listUsers({ page, perPage: 1000 }); falhou(error, 'listar usuários')
    lista.push(...data.users)
    if (data.users.length < 1000) return lista
  }
}

// Copia uma tabela em páginas, pela chave primária, ignorando o que já existe no destino
async function copiar(de, para, tabela, colunas, chave, lote, mapear = x => x) {
  const { count } = await de.from(tabela).select(chave, { count: 'exact', head: true })
  let ultimo = '', feito = 0
  process.stdout.write(`\n${tabela}: ${fmt(count || 0)} linhas\n`)
  for (;;) {
    let q = de.from(tabela).select(colunas).order(chave).limit(lote)
    if (ultimo) q = q.gt(chave, ultimo)
    const { data, error } = await q; falhou(error, `ler ${tabela}`)
    if (!data.length) break
    for (let tentativa = 1; ; tentativa++) {
      const { error: e2 } = await para.from(tabela).upsert(data.map(mapear), { onConflict: chave, ignoreDuplicates: true })
      if (!e2) break
      if (tentativa === 3) falhou(e2, `gravar ${tabela}`)
      await new Promise(r => setTimeout(r, 2000 * tentativa))
    }
    ultimo = data[data.length - 1][chave]; feito += data.length
    process.stdout.write(`\r  ${fmt(feito)} de ${fmt(count || 0)}   `)
  }
  process.stdout.write('\n')
  return feito
}

console.log('\n=== Migração NF-e Control ===')
console.log(`De:   ${ANTIGO}\nPara: ${NOVO}\n`)
const sAntigo = await perguntar('Secret key do banco ANTIGO (sb_secret_...): ', true)
const sNovo = await perguntar('Secret key do banco NOVO   (sb_secret_...): ', true)
const opt = { auth: { persistSession: false, autoRefreshToken: false } }
const de = createClient(ANTIGO, sAntigo, opt), para = createClient(NOVO, sNovo, opt)

try {
  // 0) chaves válidas e o banco novo precisa das tabelas
  const chaveRuim = e => e && /api key|jwt|unauthori[sz]ed|401|403/i.test(e.message + (e.code || ''))
  if (chaveRuim((await de.from('nfce_notas').select('chave', { head: true, count: 'exact' })).error)) throw new Error('Secret key do banco ANTIGO inválida.')
  for (const t of ['nfce_notas', 'nfce_xml', 'nfce_lojas']) {
    const { error } = await para.from(t).select('*', { head: true, count: 'exact' })
    if (chaveRuim(error)) throw new Error('Secret key do banco NOVO inválida.')
    if (error) throw new Error(`No banco NOVO falta a tabela ${t}. Rode no SQL Editor dele: supabase/schema.sql, 002_login_e_admin.sql e 003_apelido_lojas.sql.`)
  }

  // 1) usuários (mesmos e-mails, papéis e nomes; a senha não pode ser copiada)
  const uAntigos = await todosUsuarios(de), uNovos = await todosUsuarios(para)
  const porEmail = new Map(uNovos.map(u => [u.email.toLowerCase(), u.id]))
  const criados = []
  for (const u of uAntigos) {
    const em = (u.email || '').toLowerCase()
    if (!em || porEmail.has(em)) continue
    const { data, error } = await para.auth.admin.createUser({ email: u.email, email_confirm: true, app_metadata: { papel: u.app_metadata?.papel || 'usuario' }, user_metadata: u.user_metadata || {} })
    falhou(error, `criar usuário ${u.email}`)
    porEmail.set(em, data.user.id); criados.push(u.email)
  }
  const idNovo = new Map(uAntigos.map(u => [u.id, porEmail.get((u.email || '').toLowerCase()) || null]))
  console.log(`\nUsuários: ${uAntigos.length} no banco antigo, ${criados.length} criados no novo${criados.length ? ': ' + criados.join(', ') : ''}`)

  // 2) dados (quem importou cada nota é mantido, pelo e-mail)
  const quem = r => ({ ...r, importado_por: idNovo.get(r.importado_por) ?? null })
  const n = await copiar(de, para, 'nfce_notas', 'chave,cnpj,mes,loja,endereco,n,dh,total,descontos,icms,pagamentos,info,itens,importado_em,importado_por', 'chave', 1000, quem)
  const x = await copiar(de, para, 'nfce_xml', 'chave,xml_gz,importado_em,importado_por', 'chave', 300, quem)
  const { data: lojas } = await de.from('nfce_lojas').select('*')
  if (lojas?.length) { const { error } = await para.from('nfce_lojas').upsert(lojas.map(l => ({ ...l, atualizado_por: idNovo.get(l.atualizado_por) ?? null }))); falhou(error, 'gravar nfce_lojas') }

  // 3) conferência
  const conta = async (c, t) => (await c.from(t).select('*', { head: true, count: 'exact' })).count || 0
  console.log('\nConferência (antigo -> novo):')
  for (const t of ['nfce_notas', 'nfce_xml', 'nfce_lojas']) {
    const a = await conta(de, t), b = await conta(para, t)
    console.log(`  ${t.padEnd(11)} ${fmt(a).padStart(9)} -> ${fmt(b).padStart(9)}  ${b >= a ? 'OK' : 'FALTANDO ' + fmt(a - b) + ' (rode o script de novo)'}`)
  }
  console.log(`\nPronto (${fmt(n)} notas e ${fmt(x)} XMLs lidos).`)
  if (criados.length) console.log('Os usuários criados entram usando "Esqueci minha senha" na tela de login do NF-e Control.')
} catch (e) {
  console.error('\nERRO: ' + e.message)
  process.exitCode = 1
}
