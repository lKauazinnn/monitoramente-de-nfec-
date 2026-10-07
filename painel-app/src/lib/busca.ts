// Busca de notas com filtros, comparativo mensal e downloads em lote (funções de supabase/004_busca_e_comparativo.sql)
import { prep, type Mes, type Note, type RawNote } from './data'
import { gz } from './db'
import { payName } from './format'
import { baixar, gerarPdfLote, modeloDaLinha, modeloDoXml, type LinhaNota } from './pdf'
import { sb } from './remote'

export type Ordem = 'recentes' | 'antigas' | 'maior_valor' | 'menor_valor'
export interface Filtros {
  cnpjs: string[]; de: string; ate: string; numero: string; chave: string; produto: string
  pagamento: string; canal: '' | 'salao' | 'entrega'; min: string; max: string; ordem: Ordem
}
export const filtrosVazios = (): Filtros => ({ cnpjs: [], de: '', ate: '', numero: '', chave: '', produto: '', pagamento: '', canal: '', min: '', max: '', ordem: 'recentes' })

export interface NotaBusca extends LinhaNota { mes: string; icms: number }

const cliente = () => { if (!sb) throw new Error('Banco central não configurado'); return sb }
const num = (s: string) => { const v = parseFloat(s.replace(/\./g, '').replace(',', '.')); return isFinite(v) ? v : null }
const semFuncao = (m: string) => /nfce_buscar|nfce_comparativo|function|schema cache/i.test(m)
  ? 'A busca ainda não está instalada no banco: rode supabase/004_busca_e_comparativo.sql no SQL Editor do Supabase.' : m

function params(f: Filtros) {
  return {
    p_cnpjs: f.cnpjs.length ? f.cnpjs : null, p_de: f.de || null, p_ate: f.ate || null,
    p_numero: /^\d+$/.test(f.numero.trim()) ? +f.numero.trim() : null, p_chave: f.chave.replace(/\D/g, '') || null,
    p_produto: f.produto.trim() || null, p_pagamento: f.pagamento || null, p_canal: f.canal || null,
    p_min: num(f.min), p_max: num(f.max), p_ordem: f.ordem,
  }
}

export async function buscar(f: Filtros, pagina: number, porPagina: number) {
  const { data, error } = await cliente().rpc('nfce_buscar', { ...params(f), p_limite: porPagina, p_offset: pagina * porPagina })
  if (error) throw new Error(semFuncao(error.message))
  const rows = (data || []) as (NotaBusca & { qtd_total: number; soma_total: number })[]
  return { notas: rows as NotaBusca[], total: rows[0] ? +rows[0].qtd_total : 0, soma: rows[0] ? +rows[0].soma_total : 0 }
}

// Todas as notas do resultado (para downloads em lote), em páginas de 1000
export async function buscarTodas(f: Filtros, max: number, progresso: (n: number) => void) {
  const todas: NotaBusca[] = []
  for (let p = 0; todas.length < max; p++) {
    const { notas } = await buscar(f, p, 1000)
    todas.push(...notas); progresso(todas.length)
    if (notas.length < 1000) break
  }
  return todas.slice(0, max)
}

// Venda / canal / referência, igual ao painel da loja
export function venda(info: string) {
  const m = (info || '').match(/venda:\s*(\d+)\s*-\s*(ficha|entrega|mesa|comanda)\s*(\d+)/i) || []
  const tipo = (m[2] || '').toLowerCase()
  return { canal: tipo === 'entrega' ? 'entrega' as const : 'salao' as const, ref: m[2] ? tipo.charAt(0).toUpperCase() + tipo.slice(1) + ' ' + m[3] : '—' }
}

// Converte para o formato do painel (para abrir a gaveta da nota)
export function paraNota(n: NotaBusca): { note: Note; mes: Mes } {
  const prods: [string, string][] = n.itens.map(i => [i[0], i[1]])
  const raw: RawNote = [n.n, n.dh, +n.total, +n.descontos, +n.icms, n.pagamentos, n.info, n.itens.map((i, k) => [k, +i[2], +i[3], +i[4]]), n.chave]
  const mes = prep({ cnpj: n.cnpj, mes: n.mes, loja: n.loja, end: n.endereco, lacunas: 0, prods, notes: [raw] })
  return { note: mes.notes[0], mes }
}

// XMLs do banco, em lotes
export async function xmlsDe(chaves: string[], progresso: (n: number) => void) {
  const mapa = new Map<string, string>()
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await cliente().from('nfce_xml').select('chave,xml_gz').in('chave', chaves.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const r of data || []) mapa.set(r.chave, await gz(new Blob([Uint8Array.from(atob(r.xml_gz), c => c.charCodeAt(0))])).text())
    progresso(Math.min(i + 100, chaves.length))
  }
  return mapa
}

const carimbo = () => new Date().toISOString().slice(0, 16).replace(/\D/g, '')
const dec = (v: number) => (+v || 0).toFixed(2).replace('.', ',')
const csvCampo = (v: unknown) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csv = (linhas: unknown[][]) => '﻿' + linhas.map(l => l.map(csvCampo).join(';')).join('\r\n')

export function baixarCsv(notas: NotaBusca[], porItem: boolean, nomeLoja: (cnpj: string) => string) {
  const base = (n: NotaBusca) => [nomeLoja(n.cnpj), n.cnpj, n.n, n.dh.slice(8, 10) + '/' + n.dh.slice(5, 7) + '/' + n.dh.slice(0, 4), n.dh.slice(11, 16)]
  const linhas: unknown[][] = porItem
    ? [['Loja', 'CNPJ', 'Nº', 'Data', 'Hora', 'Código', 'Produto', 'Quantidade', 'Valor', 'Desconto', 'Líquido', 'Chave'],
       ...notas.flatMap(n => n.itens.map(([c, x, q, v, d]) => [...base(n), c, x, String(q).replace('.', ','), dec(v), dec(d), dec(+v - +d), n.chave]))]
    : [['Loja', 'CNPJ', 'Nº', 'Data', 'Hora', 'Canal', 'Referência', 'Pagamento', 'Itens', 'Desconto', 'ICMS', 'Total', 'Chave'],
       ...notas.map(n => { const v = venda(n.info); return [...base(n), v.canal === 'entrega' ? 'Entrega' : 'Salão', v.ref, n.pagamentos.map(p => `${payName(p[0])} ${dec(p[1])}`).join(' + '), n.itens.length, dec(n.descontos), dec(n.icms), dec(n.total), n.chave] })]
  baixar(`notas-${porItem ? 'itens-' : ''}${carimbo()}.csv`, csv(linhas), 'text/csv;charset=utf-8')
}

let jszip: Promise<unknown> | null = null
const carregarZip = () => jszip ||= new Promise((res, rej) => {
  const s = document.createElement('script')
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  s.onload = res; s.onerror = () => { jszip = null; rej(new Error('sem internet para carregar o compactador')) }
  document.head.appendChild(s)
})

export async function baixarXmlsZip(notas: NotaBusca[], nomeLoja: (cnpj: string) => string, progresso: (m: string) => void) {
  await carregarZip()
  const xmls = await xmlsDe(notas.map(n => n.chave), k => progresso(`Buscando XMLs… ${k.toLocaleString('pt-BR')} de ${notas.length.toLocaleString('pt-BR')}`))
  progresso('Compactando…')
  const zip = new (window as unknown as { JSZip: new () => any }).JSZip()
  const faltando: string[] = []
  for (const n of notas) {
    const x = xmls.get(n.chave)
    if (x) zip.file(`${nomeLoja(n.cnpj).replace(/[\\/:*?"<>|]/g, '_')}/${n.mes}/${n.chave}-procNFe.xml`, x)
    else faltando.push(`${n.chave}  nº ${n.n}  ${n.dh}`)
  }
  if (faltando.length) zip.file('notas-sem-xml.txt', 'Estas notas não têm XML no banco (importe o CSV do SSMS do período):\r\n\r\n' + faltando.join('\r\n'))
  baixar(`xmls-${carimbo()}.zip`, await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }))
  return { comXml: notas.length - faltando.length, semXml: faltando.length }
}

export async function baixarPdfs(notas: NotaBusca[], progresso: (m: string) => void) {
  const xmls = await xmlsDe(notas.map(n => n.chave), k => progresso(`Buscando XMLs… ${k.toLocaleString('pt-BR')} de ${notas.length.toLocaleString('pt-BR')}`))
  const modelos = notas.map(n => { const x = xmls.get(n.chave); return x ? modeloDoXml(x) : modeloDaLinha(n) })
  await gerarPdfLote(modelos, `notas-${carimbo()}.pdf`, i => progresso(`Gerando PDF… ${i.toLocaleString('pt-BR')} de ${notas.length.toLocaleString('pt-BR')}`))
  return { comXml: xmls.size, semXml: notas.length - xmls.size }
}

// ---------- comparativo ----------
export interface LinhaComp { mes: string; cprod: string; xprod: string; quantidade: number; valor: number; notas: number }
export async function comparativo(meses: string[], cnpjs: string[] | null) {
  const out: LinhaComp[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await cliente().rpc('nfce_comparativo', { p_meses: meses, p_cnpjs: cnpjs }).range(p * 1000, p * 1000 + 999)
    if (error) throw new Error(semFuncao(error.message))
    out.push(...((data || []) as LinhaComp[]).map(r => ({ ...r, quantidade: +r.quantidade, valor: +r.valor, notas: +r.notas })))
    if (!data || data.length < 1000) return out
  }
}
export { csv, carimbo }
