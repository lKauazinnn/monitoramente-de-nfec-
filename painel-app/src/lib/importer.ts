// Importação do CSV do SSMS (CONSULTA-SSMS.sql) — mesma lógica do Processar.ps1, roda só no navegador.
import { DB, gz } from './db'
import { calcLacunas, invalidar, loadStatic, temEstatico, type Pendente, type RawMes, type RawNote } from './data'
import { enviarNotas, enviarXmls, linhasDe, remoto } from './remote'

const g = (rx: RegExp, s: string, d = '') => { const m = rx.exec(s); return m ? m[1] : d }
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const dec = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([\da-f]+));/gi,
  (m, d, h) => d ? String.fromCharCode(+d) : h ? String.fromCharCode(parseInt(h, 16)) : ENT[m.toLowerCase()])
const xmlEsc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const utf8 = new TextDecoder()

interface Acum { cnpj: string; mes: string; loja: string; end: string; prods: [string, string][]; pidx: Map<string, number>; notes: RawNote[] }
interface Ctx { linhas: number; ok: number; erros: string[]; ver: Record<string, string>; pend: string[][]; meses: Map<string, Acum>; vistos: Set<string>; xmls: [string, Blob][] }
export interface Resultado { ok: number; linhas: number; erros: string[]; meses: { cnpj: string; mes: string }[]; segundos: number }

// Junta a NFe assinada (intacta) com o protocolo da SEFAZ
function montarProc(ch: string, texto: string, prot: string[], cnpj: string, ctx: Ctx) {
  let [nProt, dh, dig, cst, xmot, ver] = prot
  if (!nProt || !dh) throw new Error('sem protocolo no banco')
  if (cst !== '100' && cst !== '150') throw new Error(`cStat ${cst} ${xmot}`)
  const m = /(<NFe[ >][\s\S]*<\/NFe>)/.exec(texto)
  if (!m) throw new Error('NFe não encontrada no XML')
  if (g(/<DigestValue>([^<]+)<\/DigestValue>/, texto) !== dig) throw new Error('digest do banco não bate com a assinatura do XML')
  ver = ver || ctx.ver[cnpj]
  if (!ver) return null // tenta de novo no fim
  return '<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">' + m[1] +
    '<protNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infProt>' +
    `<tpAmb>${g(/<tpAmb>(\d)<\/tpAmb>/, texto)}</tpAmb><verAplic>${ver}</verAplic><chNFe>${ch}</chNFe><dhRecbto>${dh}-03:00</dhRecbto>` +
    `<nProt>${nProt}</nProt><digVal>${dig}</digVal><cStat>${cst}</cStat><xMotivo>${xmlEsc(xmot)}</xMotivo>` +
    '</infProt></protNFe></nfeProc>'
}

// p: chave, cnpj, mes, fant, algo, [nProt, dhRecbto, digest, cStat, xMotivo, verAplic,] base64
async function processarCampos(p: string[], ctx: Ctx, fimDeFila: boolean) {
  const [ch, cnpj, mes, , algo] = p
  if (ctx.vistos.has(ch)) return
  let bytes = Uint8Array.from(atob(p[p.length - 1]), c => c.charCodeAt(0))
  if (algo === 'gzip') bytes = new Uint8Array(await gz(new Blob([bytes])).arrayBuffer())
  const texto = utf8.decode(bytes)
  if (!texto.includes('NFe' + ch)) throw new Error('chave do XML não confere')
  const fim = texto.trimEnd()
  if (fim.endsWith('</nfeProc>') && texto.includes('<protNFe')) {
    const v = g(/<verAplic>([^<]+)<\/verAplic>/, texto)
    if (v && !ctx.ver[cnpj]) ctx.ver[cnpj] = v
    return adicionarXml(ctx, texto, cnpj, mes)
  }
  if (!(fim.endsWith('</NFe>') || fim.endsWith('</enviNFe>'))) throw new Error('XML incompleto (cortado na exportação)')
  if (p.length < 12) throw new Error('XML sem protocolo e a linha não traz os dados do protocolo (use a consulta nova)')
  const proc = montarProc(ch, texto, p.slice(5, 11), cnpj, ctx)
  if (proc === null) {
    if (fimDeFila) throw new Error('versão da SEFAZ (verAplic) desconhecida para esta loja')
    ctx.pend.push(p); return
  }
  return adicionarXml(ctx, proc, cnpj, mes)
}

// Extrai do XML os mesmos campos que o Processar.ps1 grava em dados/<cnpj>/<mes>.js
function notaDoXml(x: string, M: Acum): RawNote {
  if (!M.loja) {
    const e = g(/<emit>([\s\S]*?)<\/emit>/, x)
    M.loja = dec(g(/<xFant>([^<]*)/, e) || g(/<xNome>([^<]*)/, e))
    M.end = dec(`${g(/<xLgr>([^<]*)/, e)}, ${g(/<nro>([^<]*)/, e)} - ${g(/<xBairro>([^<]*)/, e)}, ${g(/<xMun>([^<]*)/, e)}/${g(/<UF>([^<]*)/, e)}`)
  }
  const t = g(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/, x)
  const pays = [...x.matchAll(/<detPag>([\s\S]*?)<\/detPag>/g)].map(([, pg]): [string, number] => [g(/<tPag>(\d+)/, pg), +g(/<vPag>([\d.]+)/, pg, '0')])
  const items = [...x.matchAll(/<det nItem="\d+">([\s\S]*?)<\/det>/g)].map(([, di]): [number, number, number, number] => {
    const c = dec(g(/<cProd>([^<]*)/, di)), nome = dec(g(/<xProd>([^<]*)/, di)), k = c + '|' + nome
    if (!M.pidx.has(k)) { M.pidx.set(k, M.prods.length); M.prods.push([c, nome]) }
    return [M.pidx.get(k)!, +g(/<qCom>([\d.]+)/, di, '0'), +g(/<vProd>([\d.]+)/, di, '0'), +g(/<vDesc>([\d.]+)/, di, '0')]
  })
  return [+g(/<nNF>(\d+)/, x, '0'), g(/<dhEmi>(\d{4}-\d\d-\d\dT\d\d:\d\d)/, x), +g(/<vNF>([\d.]+)/, t, '0'), +g(/<vDesc>([\d.]+)/, t, '0'),
    +g(/<vICMS>([\d.]+)/, t, '0'), pays, dec(g(/<infCpl>([^<]*)/, x)), items, g(/Id="NFe(\d{44})"/, x)]
}

async function adicionarXml(ctx: Ctx, xml: string, cnpj?: string, mes?: string) {
  const ch = g(/Id="NFe(\d{44})"/, xml)
  if (!ch) throw new Error('arquivo não é uma NF-e/NFC-e')
  if (ctx.vistos.has(ch)) return
  ctx.vistos.add(ch)
  cnpj ||= g(/<emit>\s*<CNPJ>(\d{14})<\/CNPJ>/, xml)
  mes ||= g(/<dhEmi>(\d{4}-\d\d)/, xml)
  const k = cnpj + '|' + mes
  let M = ctx.meses.get(k)
  if (!M) ctx.meses.set(k, M = { cnpj, mes, loja: '', end: '', prods: [], pidx: new Map(), notes: [] })
  M.notes.push(notaDoXml(xml, M))
  ctx.xmls.push([ch, await gz(new Blob([xml]), 'c').blob()])
  if (!remoto && ctx.xmls.length >= 500) await DB.put('xml', ctx.xmls.splice(0))  // no modo banco central vão no fim, depois das notas
  ctx.ok++
}

async function linhasDoArquivo(file: File, cb: (l: string) => unknown) {
  const h = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const enc = h[0] === 0xFF && h[1] === 0xFE ? 'utf-16le' : h[0] === 0xFE && h[1] === 0xFF ? 'utf-16be' : 'utf-8'
  const rd = file.stream().pipeThrough(new TextDecoderStream(enc)).getReader()
  let buf = ''
  for (;;) {
    const { done, value } = await rd.read()
    if (value) { buf += value; let i; while ((i = buf.indexOf('\n')) >= 0) { await cb(buf.slice(0, i)); buf = buf.slice(i + 1) } }
    if (done) break
  }
  if (buf) await cb(buf)
}

// Une dois meses (notas repetidas pela chave ficam uma vez só). Nunca remove nada da base.
function mergeRaw(a: RawMes | null | undefined, b: Omit<RawMes, 'lacunas'>): RawMes {
  if (!a) return { ...b, lacunas: calcLacunas(b.notes) }
  const prods = a.prods.slice(), idx = new Map(prods.map((p, i) => [p[0] + '|' + p[1], i]))
  const mapa = b.prods.map(p => { const k = p[0] + '|' + p[1]; if (!idx.has(k)) { idx.set(k, prods.length); prods.push(p) } return idx.get(k)! })
  const tem = new Set(a.notes.map(n => n[8]))
  const novas = b.notes.filter(n => !tem.has(n[8])).map(n => { const c = n.slice() as RawNote; c[7] = n[7].map(([p, ...r]) => [mapa[p], ...r]); return c })
  const notes = a.notes.concat(novas)
  return { cnpj: a.cnpj, mes: a.mes, loja: a.loja || b.loja, end: a.end || b.end, prods, notes, lacunas: calcLacunas(notes) }
}

export async function importar(lista: File[], progresso: (msg: string) => void): Promise<Resultado> {
  const files = lista.filter(f => /\.(csv|txt|xml)$/i.test(f.name))
  if (!files.length) throw new Error('Selecione os arquivos .csv salvos do SSMS (ou XMLs de NFC-e).')
  const ctx: Ctx = { linhas: 0, ok: 0, erros: [], ver: {}, pend: [], meses: new Map(), vistos: new Set(), xmls: [] }
  const tentar = async (ch: string, fn: () => Promise<unknown>) => { try { await fn() } catch (e) { ctx.erros.push(ch + ' - ' + (e as Error).message) } }
  const t0 = Date.now()
  for (const f of files) {
    progresso(`Lendo ${f.name}…`)
    if (/\.xml$/i.test(f.name)) {
      await tentar(f.name, async () => { const x = await f.text(); if (!x.includes('<protNFe')) throw new Error('XML sem protocolo de autorização'); await adicionarXml(ctx, x) })
      continue
    }
    await linhasDoArquivo(f, raw => {
      const l = raw.trim().replace(/^\uFEFF/, '').replace(/^"+|"+$/g, '')
      if (!/^\d{44}\|/.test(l)) return
      if (++ctx.linhas % 500 === 0) progresso(`Lendo ${f.name}… ${ctx.linhas.toLocaleString('pt-BR')} notas`)
      let p = l.split('|')
      if (p.length > 12) p = p.slice(0, 11).concat(p.slice(11).join('|'))
      if (p.length !== 6 && p.length !== 12) { ctx.erros.push(p[0] + ' - linha com formato inesperado'); return }
      return tentar(p[0], () => processarCampos(p, ctx, false))
    })
  }
  for (const p of ctx.pend) await tentar(p[0], () => processarCampos(p, ctx, true))
  if (remoto) {
    await enviarNotas([...ctx.meses.values()].flatMap(M => linhasDe(M)), progresso)
    await enviarXmls(ctx.xmls, progresso)
    ctx.meses.forEach((_, k) => invalidar(k))
  } else {
    if (ctx.xmls.length) await DB.put('xml', ctx.xmls.splice(0))
    progresso('Montando dados do painel…')
    const novos: [string, RawMes][] = []
    for (const [k, M] of ctx.meses) {
      let base = await DB.get<RawMes>('mes', k)
      if (!base && temEstatico(M.cnpj, M.mes)) base = await loadStatic(M.cnpj, M.mes).catch(() => undefined)
      novos.push([k, mergeRaw(base, { cnpj: M.cnpj, mes: M.mes, loja: M.loja, end: M.end, prods: M.prods, notes: M.notes })])
      invalidar(k)
    }
    await DB.put('mes', novos)
  }
  return { ok: ctx.ok, linhas: ctx.linhas, erros: ctx.erros, meses: [...ctx.meses.values()].map(M => ({ cnpj: M.cnpj, mes: M.mes })), segundos: Math.round((Date.now() - t0) / 1000) }
}

// Leva para o banco central os meses publicados em dados/ (gerados pelo Processar.ps1). Notas repetidas são ignoradas.
export async function enviarPublicados(pendentes: Pendente[], progresso: (msg: string) => void) {
  let total = 0
  for (const p of pendentes) {
    const raw = await loadStatic(p.cnpj, p.mes)
    await enviarNotas(linhasDe(raw), m => progresso(`${p.loja} ${p.mes}: ${m}`))
    invalidar(p.cnpj + '|' + p.mes)
    total += raw.notes.length
  }
  return total
}
