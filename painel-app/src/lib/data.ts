import { DB, xmlDa } from './db'
import { mesRemoto, remoto, resumoRemoto, sb, xmlRemoto } from './remote'
import { nomeAuto } from './format'

// Formato de dados/<cnpj>/<mes>.js (gerado pelo Processar.ps1 e pela importação no navegador)
// nota: [nNF, dhEmi, vNF, vDesc, vICMS, [[tPag, vPag]], infCpl, [[iProd, qCom, vProd, vDesc]], chave]
export type RawNote = [number, string, number, number, number, [string, number][], string, [number, number, number, number][], string]
export interface RawMes { cnpj: string; mes: string; loja: string; end: string; lacunas: number; prods: [string, string][]; notes: RawNote[] }
// notas/total já sem canceladas e repetidas; canceladas/cancelado e repetidas/repetido = o que ficou de fora do faturamento
export interface LojaMes { mes: string; notas: number; total: number; canceladas?: number; cancelado?: number; repetidas?: number; repetido?: number }
// Evento de cancelamento (110111 cancelamento, 110112 cancelamento por substituição)
export interface Cancelamento {
  chave: string; cnpj: string; tipo: string; protocolo: string; cstat: string; dh_evento: string; chave_substituta: string; origem: string
}
// loja = nome fiscal (xFant da nota); nome = como aparece no painel (apelido do admin ou Caju + bairro)
export interface Loja { cnpj: string; loja: string; nome: string; apelido: string; end: string; meses: LojaMes[] }
export interface Item { p: number; q: number; v: number; d: number; g: boolean }
export interface Pay { c: string; v: number }
export interface Note {
  n: number; dh: string; date: string; hour: number; total: number; desc: number; icms: number; chave: string; info: string
  pays: Pay[]; venda: string; canal: 'salao' | 'entrega'; ref: string; items: Item[]; gorj: number; od: string
}
export interface Mes extends Omit<RawMes, 'notes'> { notes: Note[] }
export interface Resumo extends LojaMes { cnpj: string; loja: string; end: string }

declare global {
  interface Window { NFCE_LOJAS?: (d: { gerado: string; lojas: Pick<Loja, 'cnpj' | 'loja' | 'end' | 'meses'>[] }) => void; NFCE_LOAD?: (d: RawMes) => void }
}

export const CUT = 5 // dia operacional vira às 05h
const isGorjeta = (nome?: string) => /gorjeta|taxa de servi|servi[cç]o 10/i.test(nome || '')

let STATIC: Pick<Loja, 'cnpj' | 'loja' | 'end' | 'meses'>[] = []
let gerado = ''
const esperando: Record<string, (d: RawMes) => void> = {}
window.NFCE_LOAD = d => { const k = d.cnpj + '|' + d.mes, r = esperando[k]; delete esperando[k]; r?.(d) }

function script(src: string, onerror: () => void) {
  const s = document.createElement('script')
  s.src = src; s.onerror = onerror
  document.body.appendChild(s)
}

export const carregarIndice = () => new Promise<void>(res => {
  window.NFCE_LOJAS = d => { STATIC = d.lojas || []; gerado = d.gerado; res() }
  script('dados/lojas.js?' + Date.now(), () => res())
})
export const geradoEm = () => gerado

export const temEstatico = (cnpj: string, mes: string) => STATIC.some(l => l.cnpj === cnpj && l.meses.some(m => m.mes === mes))
export function loadStatic(cnpj: string, mes: string) {
  return new Promise<RawMes>((res, rej) => {
    const k = cnpj + '|' + mes, arq = 'dados/' + cnpj + '/' + mes + '.js'
    if (!temEstatico(cnpj, mes)) return rej(new Error('Sem dados deste mês para esta loja'))
    esperando[k] = res
    script(arq + '?' + gerado, () => { delete esperando[k]; rej(new Error('Arquivo ' + arq + ' não encontrado')) })
  })
}

function opDay(date: string, hour: number) {
  if (hour >= CUT) return date
  const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function prep(d: RawMes): Mes {
  const ini = d.mes + '-01' // madrugada do dia 1 conta no dia 1 (o dia anterior é de outro mês)
  const notes = d.notes.map(([n, dh, total, desc, icms, pays, info, items, chave]): Note => {
    const m = (info || '').match(/venda:\s*(\d+)\s*-\s*(ficha|entrega|mesa|comanda)\s*(\d+)/i) || []
    const tipo = (m[2] || '').toLowerCase()
    const it = items.map(([p, q, v, dd]) => ({ p, q, v, d: dd, g: isGorjeta((d.prods[p] || [])[1]) }))
    const date = dh.slice(0, 10), hour = +dh.slice(11, 13), od = opDay(date, hour)
    return {
      n, dh, date, hour, total, desc, icms, chave, info, od: od < ini ? ini : od,
      pays: pays.map(([c, v]) => ({ c, v })), venda: m[1] || '—',
      canal: tipo === 'entrega' ? 'entrega' : 'salao',
      ref: m[2] ? tipo.charAt(0).toUpperCase() + tipo.slice(1) + ' ' + m[3] : '—',
      items: it, gorj: it.filter(i => i.g).reduce((s, i) => s + i.v, 0),
    }
  })
  return { ...d, notes }
}

const cache: Record<string, Mes> = {}
export const invalidar = (k: string) => { delete cache[k] }
export const invalidarLoja = (cnpj: string) => Object.keys(cache).forEach(k => { if (k.startsWith(cnpj + '|')) delete cache[k] })
export async function loadMes(cnpj: string, mes: string): Promise<Mes> {
  const k = cnpj + '|' + mes
  if (!cache[k]) {
    if (remoto) cache[k] = prep(await mesRemoto(cnpj, mes))   // o banco central já entrega sem canceladas e repetidas
    else {
      const r = (await DB.get<RawMes>('mes', k)) || (await loadStatic(cnpj, mes))
      cache[k] = prep({ ...r, notes: validas(r.notes, await canceladasLocais()).notas })
    }
  }
  return cache[k]
}

// Chaves canceladas importadas neste navegador (modo sem banco central)
export async function canceladasLocais(): Promise<Set<string>> {
  try { return new Set((await DB.all<Cancelamento>('canc')).map(c => c.chave)) } catch { return new Set() }
}

// Mesma venda do PDV emitida em duas notas (ex.: online + contingência): mesma venda, ficha/mesa/entrega, valor e itens,
// até 30 min de diferença. Fica a de contingência (tpEmis 9) ou, se forem do mesmo tipo, a primeira chave.
// Mesma regra de nfce_marcar_repetidas (supabase/005_canceladas.sql).
export function repetidas(notes: RawNote[]): Set<string> {
  const grupos = new Map<string, RawNote[]>()
  for (const n of notes) {
    const m = /venda:\s*(\d+)\s*-\s*(ficha|entrega|mesa|comanda)\s*(\d+)/i.exec(n[6] || '')
    if (!m || !(n[2] > 0)) continue
    const k = [m[1], m[2].toLowerCase(), m[3], n[2], JSON.stringify(n[7])].join('|')
    const g = grupos.get(k)
    if (g) g.push(n); else grupos.set(k, [n])
  }
  const fora = new Set<string>()
  for (const g of grupos.values()) {
    if (g.length < 2) continue
    for (const b of g) for (const x of g) {
      if (x === b || Math.abs(Date.parse(x[1]) - Date.parse(b[1])) > 30 * 60e3) continue
      const tb = b[8][34], tx = x[8][34]
      if ((tx === '9' && tb !== '9') || (tx === tb && x[8] < b[8])) { fora.add(b[8]); break }
    }
  }
  return fora
}

// O que entra no faturamento: sem as canceladas e sem as repetidas
export function validas(notes: RawNote[], canc: Set<string>) {
  const semCanc = notes.filter(n => !canc.has(n[8])), rep = repetidas(semCanc)
  return { notas: semCanc.filter(n => !rep.has(n[8])), canceladas: notes.filter(n => canc.has(n[8])), repetidas: semCanc.filter(n => rep.has(n[8])) }
}

const r2 = (v: number) => Math.round(v * 100) / 100
const soma = (ns: RawNote[]) => r2(ns.reduce((s, n) => s + n[2], 0))
export function resumoDe(r: RawMes, canc: Set<string> = new Set()): Resumo {
  const v = validas(r.notes, canc)
  return {
    cnpj: r.cnpj, mes: r.mes, loja: r.loja, end: r.end, notas: v.notas.length, total: soma(v.notas),
    canceladas: v.canceladas.length, cancelado: soma(v.canceladas), repetidas: v.repetidas.length, repetido: soma(v.repetidas),
  }
}

export function calcLacunas(notes: RawNote[]) {
  const ser: Record<string, Set<number>> = {}
  notes.forEach(n => (ser[n[8].slice(22, 25)] ||= new Set()).add(n[0]))
  return Object.values(ser).reduce((t, s) => {
    const a = [...s]
    return t + a.reduce((x, y) => Math.max(x, y)) - a.reduce((x, y) => Math.min(x, y)) + 1 - a.length
  }, 0)
}

export const buscarXml = (chave: string) => remoto ? xmlRemoto(chave) : xmlDa(chave)

// Meses publicados em dados/ que ainda não estão (completos) no banco central
export interface Pendente { cnpj: string; mes: string; loja: string; notas: number }
export interface Lojas { lojas: Loja[]; importadas: number; pendentes: Pendente[] }

export async function montarLojas(): Promise<Lojas> {
  if (remoto) {
    const rem = await resumoRemoto()
    const noBanco = (r?: Resumo) => r ? r.notas + (r.canceladas || 0) + (r.repetidas || 0) : 0
    const pendentes = STATIC.flatMap(l => l.meses
      .filter(m => noBanco(rem.find(r => r.cnpj === l.cnpj && r.mes === m.mes)) < m.notas)
      .map(m => ({ cnpj: l.cnpj, mes: m.mes, loja: l.loja, notas: m.notas })))
    const { data: ap } = await sb!.from('nfce_lojas').select('cnpj,apelido')  // sem a migração 003: sem apelidos
    const apelidos = new Map((ap || []).map(a => [a.cnpj as string, (a.apelido as string) || '']))
    return { lojas: agrupar([], rem, apelidos), importadas: rem.reduce((s, r) => s + r.notas, 0), pendentes }
  }
  // Sem banco central: junta o que foi publicado (dados/) com o que foi importado neste navegador
  let imp: Resumo[] = []
  const canc = await canceladasLocais()
  try { imp = (await DB.all<RawMes>('mes')).map(r => resumoDe(r, canc)) } catch { /* sem base local */ }
  return { lojas: agrupar(STATIC, imp), importadas: imp.reduce((s, r) => s + r.notas, 0), pendentes: [] }
}

function agrupar(estatico: Pick<Loja, 'cnpj' | 'loja' | 'end' | 'meses'>[], imp: Resumo[], apelidos = new Map<string, string>()): Loja[] {
  const map = new Map<string, Loja>()
  const add = (cnpj: string, loja: string, end: string, m: LojaMes) => {
    let L = map.get(cnpj)
    if (!L) map.set(cnpj, L = { cnpj, loja, end, meses: [], apelido: apelidos.get(cnpj) || '', nome: apelidos.get(cnpj) || nomeAuto(loja, end) })
    const i = L.meses.findIndex(x => x.mes === m.mes)
    if (i >= 0) L.meses[i] = m; else L.meses.push(m)
  }
  estatico.forEach(l => l.meses.forEach(m => add(l.cnpj, l.loja, l.end, m)))
  imp.forEach(r => add(r.cnpj, r.loja, r.end, { mes: r.mes, notas: r.notas, total: r.total, canceladas: r.canceladas || 0, cancelado: r.cancelado || 0,
    repetidas: r.repetidas || 0, repetido: r.repetido || 0 }))
  const lojas = [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  lojas.forEach(l => l.meses.sort((a, b) => a.mes.localeCompare(b.mes)))
  return lojas
}
