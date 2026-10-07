// Banco central no Supabase (tabelas de supabase/schema.sql)
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config'
import { calcLacunas, type RawMes, type RawNote, type Resumo } from './data'
import { gz } from './db'

export const remoto = !!(SUPABASE_URL && SUPABASE_ANON_KEY)
export const sb = remoto ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, storageKey: 'nfce-auth' } }) : null

const POR_PAGINA = 1000
const COLUNAS = 'chave,cnpj,mes,loja,endereco,n,dh,total,descontos,icms,pagamentos,info,itens'

interface Linha {
  chave: string; cnpj: string; mes: string; loja: string; endereco: string; n: number; dh: string
  total: number; descontos: number; icms: number; pagamentos: [string, number][]; info: string
  itens: [string, string, number, number, number][]
}

const cliente = () => { if (!sb) throw new Error('Banco central não configurado'); return sb }
const falhou = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

export function linhasDe(r: Pick<RawMes, 'cnpj' | 'mes' | 'loja' | 'end' | 'prods' | 'notes'>): Linha[] {
  return r.notes.map(n => ({
    chave: n[8], cnpj: r.cnpj, mes: r.mes, loja: r.loja, endereco: r.end, n: n[0], dh: n[1], total: n[2], descontos: n[3], icms: n[4],
    pagamentos: n[5], info: n[6], itens: n[7].map(([p, q, v, d]) => [r.prods[p][0], r.prods[p][1], q, v, d]),
  }))
}

function rawDe(cnpj: string, mes: string, rows: Linha[]): RawMes {
  const prods: [string, string][] = [], idx = new Map<string, number>()
  const notes = rows.map((l): RawNote => [l.n, l.dh, +l.total, +l.descontos, +l.icms, l.pagamentos, l.info,
    l.itens.map(([c, x, q, v, d]) => {
      const k = c + '|' + x
      if (!idx.has(k)) { idx.set(k, prods.length); prods.push([c, x]) }
      return [idx.get(k)!, q, v, d]
    }), l.chave])
  return { cnpj, mes, loja: rows[0]?.loja || '', end: rows[0]?.endereco || '', prods, notes, lacunas: calcLacunas(notes) }
}

export async function resumoRemoto(): Promise<Resumo[]> {
  const { data, error } = await cliente().from('nfce_resumo').select('*')
  falhou(error)
  return (data || []).map(r => ({ cnpj: r.cnpj, mes: r.mes, loja: r.loja, end: r.endereco, notas: +r.notas, total: Math.round(+r.total * 100) / 100 }))
}

export async function mesRemoto(cnpj: string, mes: string): Promise<RawMes> {
  const c = cliente()
  const { count, error } = await c.from('nfce_notas').select('chave', { count: 'exact', head: true }).eq('cnpj', cnpj).eq('mes', mes)
  falhou(error)
  if (!count) throw new Error('Sem notas deste mês para esta loja')
  const partes = await Promise.all(Array.from({ length: Math.ceil(count / POR_PAGINA) }, async (_, i) => {
    const r = await c.from('nfce_notas').select(COLUNAS).eq('cnpj', cnpj).eq('mes', mes).order('chave').range(i * POR_PAGINA, (i + 1) * POR_PAGINA - 1)
    falhou(r.error)
    return (r.data || []) as Linha[]
  }))
  return rawDe(cnpj, mes, partes.flat())
}

// Envia em lotes; notas que já estão no banco são ignoradas (nada é sobrescrito)
export async function enviarNotas(rows: Linha[], progresso: (m: string) => void) {
  const c = cliente()
  for (let i = 0; i < rows.length; i += 500) {
    progresso(`Enviando notas para o banco… ${Math.min(i + 500, rows.length).toLocaleString('pt-BR')} de ${rows.length.toLocaleString('pt-BR')}`)
    const { error } = await c.from('nfce_notas').upsert(rows.slice(i, i + 500), { onConflict: 'chave', ignoreDuplicates: true })
    falhou(error)
  }
}

const base64 = async (b: Blob) => {
  const u = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function enviarXmls(xmls: [string, Blob][], progresso: (m: string) => void) {
  const c = cliente()
  for (let i = 0; i < xmls.length; i += 200) {
    progresso(`Enviando XMLs para o banco… ${Math.min(i + 200, xmls.length).toLocaleString('pt-BR')} de ${xmls.length.toLocaleString('pt-BR')}`)
    const lote = await Promise.all(xmls.slice(i, i + 200).map(async ([chave, b]) => ({ chave, xml_gz: await base64(b) })))
    const { error } = await c.from('nfce_xml').upsert(lote, { onConflict: 'chave', ignoreDuplicates: true })
    falhou(error)
  }
}

export async function xmlRemoto(chave: string): Promise<string | null> {
  const { data, error } = await cliente().from('nfce_xml').select('xml_gz').eq('chave', chave).maybeSingle()
  falhou(error)
  if (!data) return null
  return gz(new Blob([Uint8Array.from(atob(data.xml_gz), ch => ch.charCodeAt(0))])).text()
}
