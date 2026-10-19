// Importação no navegador — mesma lógica do Processar.ps1. Aceita:
//   • CSV do SSMS (CONSULTA-SSMS.sql): notas, arquivo só de protocolos e lista de cancelamentos
//   • XMLs de NFC-e e .zip com os XMLs exportados pelo emissor (pastas Autorizadas / Canceladas / Inutilizadas)
//   • relatório do emissor (modelo;série;número;data;valor;chave;situação), usado só para saber quais foram canceladas
// Nota cancelada nunca entra como venda: o cancelamento é guardado à parte e os totais a desconsideram.
// Nota repetida também não: a mesma chave entra uma vez só, e a mesma venda do PDV emitida em duas notas
// (ex.: online + contingência) conta uma vez (ver repetidas() em data.ts e nfce_marcar_repetidas no banco).
import { DB, gz } from './db'
import { calcLacunas, canceladasLocais, invalidar, invalidarLoja, loadStatic, resumoDe, temEstatico, type Cancelamento, type Pendente, type RawMes, type RawNote } from './data'
import { enviarCanceladas, enviarNotas, enviarXmls, linhasDe, marcarRepetidas, remoto } from './remote'
import { lerZip } from './zip'

const g = (rx: RegExp, s: string, d = '') => { const m = rx.exec(s); return m ? m[1] : d }
const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
const dec = (s: string) => s.replace(/&(?:amp|lt|gt|quot|apos|#(\d+)|#x([\da-f]+));/gi,
  (m, d, h) => d ? String.fromCharCode(+d) : h ? String.fromCharCode(parseInt(h, 16)) : ENT[m.toLowerCase()])
const xmlEsc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const utf8 = new TextDecoder()
const CANC_OK = ['135', '136', '155']   // evento registrado (vinculado / não vinculado / fora de prazo)
const mesDaChave = (ch: string) => '20' + ch.slice(2, 4) + '-' + ch.slice(4, 6)

interface Acum { cnpj: string; mes: string; loja: string; end: string; prods: [string, string][]; pidx: Map<string, number>; notes: RawNote[] }
interface Ctx {
  linhas: number; ok: number; erros: string[]; ver: Record<string, string>; pend: string[][]; meses: Map<string, Acum>; vistos: Set<string>
  xmls: [string, Blob][]; prot: Map<string, string[]>; canc: Map<string, Cancelamento>; ignorados: number
}
export interface Resultado {
  ok: number; linhas: number; erros: string[]; meses: { cnpj: string; mes: string }[]; segundos: number
  canceladas: number; repetidas: number; ignorados: number
}

// xml_proc_algo vem 'gzip' (procNFe) ou 'gzipenv' (enviNFe): decide pelo conteúdo, não pelo nome
async function textoDe(b64: string) {
  let bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await gz(new Blob([bytes])).arrayBuffer())
  return utf8.decode(bytes)
}

function cancelar(ctx: Ctx, ch: string, tipo: string, origem: string, extra: Partial<Cancelamento> = {}) {
  ctx.canc.set(ch, { chave: ch, cnpj: ch.slice(6, 20), tipo, protocolo: '', cstat: '', dh_evento: '', chave_substituta: '', origem: origem.slice(-200), ...extra })
}

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
  const [ch, cnpj, mes] = p
  if (ctx.vistos.has(ch)) return
  const b64 = p[p.length - 1]
  if (!b64) throw new Error('XML vazio no banco (a nota existe no FiscalGateway, mas a coluna do XML veio sem conteúdo)')
  const texto = await textoDe(b64)
  if (!texto.includes('NFe' + ch)) throw new Error('chave do XML não confere')
  const fim = texto.trimEnd()
  if (fim.endsWith('</nfeProc>') && texto.includes('<protNFe')) {
    const v = g(/<verAplic>([^<]+)<\/verAplic>/, texto)
    if (v && !ctx.ver[cnpj]) ctx.ver[cnpj] = v
    return adicionarXml(ctx, texto, cnpj, mes)
  }
  if (!(fim.endsWith('</NFe>') || fim.endsWith('</enviNFe>'))) throw new Error('XML incompleto (cortado na exportação)')
  // protocolo: da própria linha (consulta nova) ou de um arquivo só de protocolos selecionado junto
  const daLinha = p.length === 12 && p[5] ? p.slice(5, 11) : undefined
  if (!daLinha && !ctx.prot.has(ch) && !fimDeFila) { ctx.pend.push(p); return }
  const prot = daLinha || ctx.prot.get(ch) || (p.length === 12 ? p.slice(5, 11) : undefined)
  if (!prot) throw new Error('XML sem protocolo e a linha não traz os dados do protocolo (use a consulta nova ou selecione junto o arquivo de protocolos)')
  const proc = montarProc(ch, texto, prot, cnpj, ctx)
  if (proc === null) {
    if (fimDeFila) throw new Error('versão da SEFAZ (verAplic) desconhecida para esta loja')
    ctx.pend.push(p); return
  }
  return adicionarXml(ctx, proc, cnpj, mes)
}

// Evento de cancelamento (XML do emissor): 110111 cancelamento, 110112 cancelamento por substituição
function registrarEvento(nome: string, x: string, ctx: Ctx) {
  const tp = g(/<tpEvento>(\d+)<\/tpEvento>/, x)
  if (tp !== '110111' && tp !== '110112') { ctx.ignorados++; return }   // carta de correção etc. não mudam o valor
  const ch = g(/<chNFe>(\d{44})<\/chNFe>/, x)
  if (!ch) throw new Error('evento de cancelamento sem a chave da nota')
  const ret = g(/<retEvento[\s>]([\s\S]*?)<\/retEvento>/, x), cst = g(/<cStat>(\d+)<\/cStat>/, ret)
  if (ret && !CANC_OK.includes(cst)) throw new Error(`cancelamento recusado pela SEFAZ (cStat ${cst} ${g(/<xMotivo>([^<]*)/, ret)})`)
  cancelar(ctx, ch, tp, nome, {
    protocolo: g(/<nProt>(\d+)<\/nProt>/, ret), cstat: cst, chave_substituta: g(/<chNFeRef>(\d{44})<\/chNFeRef>/, x),
    dh_evento: g(/<dhRegEvento>([^<]+)/, ret) || g(/<dhEvento>([^<]+)/, x),
  })
}

// Um XML (arquivo solto ou de dentro de um .zip)
async function processarXml(nome: string, x: string, ctx: Ctx) {
  if (/<tpEvento>/.test(x) && /<(procEventoNFe|envEvento|evento)[\s>]/.test(x)) return registrarEvento(nome, x, ctx)
  if (/<(procInutNFe|inutNFe|retInutNFe|ProcInutNFe)[\s>]/.test(x)) { ctx.ignorados++; return }   // inutilização: não é venda
  const ch = g(/Id="NFe(\d{44})"/, x)
  if (!ch) throw new Error('arquivo não é uma NF-e/NFC-e')
  // nota que o emissor já separou como cancelada: não entra como venda (o evento, quando vem junto, traz o protocolo)
  if (/(^|[\\/])Canceladas[\\/]/i.test(nome)) { if (!ctx.canc.has(ch)) cancelar(ctx, ch, 'pasta Canceladas', nome); return }
  if (!x.includes('<protNFe')) throw new Error('XML sem protocolo de autorização')
  const cst = g(/<protNFe[\s\S]*?<cStat>(\d+)<\/cStat>/, x)
  if (cst !== '100' && cst !== '150') throw new Error(`nota não autorizada (cStat ${cst} ${g(/<protNFe[\s\S]*?<xMotivo>([^<]*)/, x)})`)
  return adicionarXml(ctx, x)
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
  if (g(/<tpAmb>(\d)<\/tpAmb>/, xml) === '2') throw new Error('nota de homologação (teste, sem valor fiscal)')
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

// Linhas que não são de nota: relatório do emissor com a situação de cada chave
function linhaDeRelatorio(l: string, arq: string, ctx: Ctx) {
  const r = l.split(';')
  if (r.length >= 7 && /^\d{44}$/.test(r[5]) && /cancel/i.test(r[6])) cancelar(ctx, r[5], 'relatório: ' + r[6].trim(), arq)
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
  const files = lista.filter(f => /\.(csv|txt|xml|zip)$/i.test(f.name))
  if (!files.length) throw new Error('Selecione os arquivos .csv salvos do SSMS, XMLs de NFC-e ou .zip com os XMLs.')
  const ctx: Ctx = { linhas: 0, ok: 0, erros: [], ver: {}, pend: [], meses: new Map(), vistos: new Set(), xmls: [], prot: new Map(), canc: new Map(), ignorados: 0 }
  const tentar = async (ch: string, fn: () => unknown) => { try { await fn() } catch (e) { ctx.erros.push(ch + ' - ' + (e as Error).message) } }
  const t0 = Date.now()
  for (const f of files) {
    progresso(`Lendo ${f.name}…`)
    if (/\.zip$/i.test(f.name)) {
      await tentar(f.name, () => lerZip(f, n => /\.xml$/i.test(n), (nome, dados, i, total) => {
        if (i % 500 === 0) progresso(`Lendo ${f.name}… ${i.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} XMLs`)
        return tentar(`${f.name} > ${nome}`, () => processarXml(nome, utf8.decode(dados), ctx))
      }))
      continue
    }
    if (/\.xml$/i.test(f.name)) {
      await tentar(f.name, async () => processarXml(f.webkitRelativePath || f.name, await f.text(), ctx))
      continue
    }
    await linhasDoArquivo(f, raw => {
      const l = raw.trim().replace(/^\uFEFF/, '').replace(/^"+|"+$/g, '')
      if (!/^\d{44}\|/.test(l)) return linhaDeRelatorio(l, f.name, ctx)
      let p = l.split('|')
      // chave|CANCELAMENTO|tpEvento|cStat|nProt|dhEvento|chaveSubstituta  (PASSO 3 da CONSULTA-SSMS.sql)
      if (p[1] === 'CANCELAMENTO') return tentar(p[0], () => {
        if (p[3] && !CANC_OK.includes(p[3])) throw new Error(`cancelamento recusado pela SEFAZ (cStat ${p[3]})`)
        cancelar(ctx, p[0], p[2] || '110111', f.name, { cstat: p[3] || '', protocolo: p[4] || '', dh_evento: p[5] || '', chave_substituta: p[6] || '' })
      })
      // chave|nProt|dhRecbto|digest|cStat|xMotivo|verAplic  (arquivo só de protocolos, para XMLs que vieram sem)
      if (p.length === 7) { ctx.prot.set(p[0], p.slice(1, 7)); return }
      if (++ctx.linhas % 500 === 0) progresso(`Lendo ${f.name}… ${ctx.linhas.toLocaleString('pt-BR')} notas`)
      if (p.length > 12) p = p.slice(0, 11).concat(p.slice(11).join('|'))
      if (p.length !== 6 && p.length !== 12) { ctx.erros.push(p[0] + ' - linha com formato inesperado'); return }
      return tentar(p[0], () => processarCampos(p, ctx, false))
    })
  }
  for (const p of ctx.pend) await tentar(p[0], () => processarCampos(p, ctx, true))
  // nota que falhou num arquivo mas entrou por outro (ex.: sem XML no CSV, com XML no .zip) não é erro
  ctx.erros = ctx.erros.filter(e => { const ch = e.slice(0, 44); return !(/^\d{44}$/.test(ch) && (ctx.vistos.has(ch) || ctx.canc.has(ch))) })
  const canc = [...ctx.canc.values()]
  const mesesCanc = new Set(canc.map(c => c.cnpj + '|' + mesDaChave(c.chave)))
  let repetidas = 0
  if (remoto) {
    if (canc.length) await enviarCanceladas(canc, progresso)   // antes das notas: nenhuma cancelada chega a contar no total
    await enviarNotas([...ctx.meses.values()].flatMap(M => linhasDe(M)), progresso)
    await enviarXmls(ctx.xmls, progresso)
    const lojas = [...new Set([...ctx.meses.values()].map(M => M.cnpj).concat(canc.map(c => c.cnpj)))]
    try { repetidas = await marcarRepetidas(lojas, progresso) }
    catch (e) { ctx.erros.push('Notas repetidas não conferidas - ' + (e as Error).message) }
    lojas.forEach(invalidarLoja)   // repetidas podem estar em qualquer mês da loja
  } else {
    if (ctx.xmls.length) await DB.put('xml', ctx.xmls.splice(0))
    if (canc.length) await DB.put('canc', canc.map(c => [c.chave, c]))
    progresso('Montando dados do painel…')
    const novos: [string, RawMes][] = []
    for (const [k, M] of ctx.meses) {
      let base = await DB.get<RawMes>('mes', k)
      if (!base && temEstatico(M.cnpj, M.mes)) base = await loadStatic(M.cnpj, M.mes).catch(() => undefined)
      novos.push([k, mergeRaw(base, { cnpj: M.cnpj, mes: M.mes, loja: M.loja, end: M.end, prods: M.prods, notes: M.notes })])
      invalidar(k)
    }
    // mês publicado (dados/) com nota cancelada passa para a base local, para o total já sair sem ela
    for (const k of mesesCanc) {
      invalidar(k)
      const [cnpj, mes] = k.split('|')
      if (ctx.meses.has(k) || !temEstatico(cnpj, mes) || await DB.get<RawMes>('mes', k)) continue
      const base = await loadStatic(cnpj, mes).catch(() => undefined)
      if (base) novos.push([k, base])
    }
    await DB.put('mes', novos)
    const cs = await canceladasLocais()
    repetidas = novos.reduce((s, [, r]) => s + (resumoDe(r, cs).repetidas || 0), 0)
  }
  return {
    ok: ctx.ok, linhas: ctx.linhas, erros: ctx.erros, meses: [...ctx.meses.values()].map(M => ({ cnpj: M.cnpj, mes: M.mes })),
    segundos: Math.round((Date.now() - t0) / 1000), canceladas: canc.length, repetidas, ignorados: ctx.ignorados,
  }
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
