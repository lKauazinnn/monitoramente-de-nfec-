import { useContext, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, CircleAlert, FileSpreadsheet, LoaderCircle, Search } from 'lucide-react'
import type { Loja } from '../lib/data'
import { comparativo, csv, carimbo, type LinhaComp } from '../lib/busca'
import { brl, brl0, kf, mesCurto, mesLabel, nf, pct, qf } from '../lib/format'
import { baixar } from '../lib/pdf'
import { PaletaCtx } from './charts'
import { Badge, Button, Card, CardHeader, Empty, Segmented, Select, Skeleton, cx } from './ui'

const CORES = ['#E4572E', '#6366F1', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9', '#8B5CF6', '#84CC16', '#A16207', '#14B8A6', '#F43F5E', '#94A3B8']
const isGorjeta = (nome: string) => /gorjeta|taxa de servi|servi[cç]o 10/i.test(nome)
type Ordem = 'maior' | 'cresce' | 'cai'

function Variacao({ a, b }: { a: number; b: number }) {
  if (!a && !b) return <span className="text-subtle">—</span>
  if (!a) return <Badge tone="ok">novo</Badge>
  const d = (b - a) / a
  return <span className={cx('num inline-flex items-center gap-0.5 font-medium', d >= 0 ? 'text-ok' : 'text-danger')}>
    {d >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{pct(Math.abs(d))}
  </span>
}

export function Comparativo({ lojas }: { lojas: Loja[] }) {
  const c = useContext(PaletaCtx)
  const [loja, setLoja] = useState('')
  const disponiveis = useMemo(() => [...new Set(lojas.filter(l => !loja || l.cnpj === loja).flatMap(l => l.meses.map(m => m.mes)))].sort(), [lojas, loja])
  const [meses, setMeses] = useState<string[]>(() => disponiveis.slice(-2))
  const [met, setMet] = useState<'v' | 'q'>('v')
  const [q, setQ] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('maior')
  const [gorjeta, setGorjeta] = useState(false)
  const [mostrar, setMostrar] = useState(40)
  const [linhas, setLinhas] = useState<LinhaComp[] | null>(null)
  const [erro, setErro] = useState('')

  const sel = useMemo(() => meses.filter(m => disponiveis.includes(m)).sort(), [meses, disponiveis])
  const toggle = (m: string) => setMeses(s => s.includes(m) ? s.filter(x => x !== m) : [...s, m])
  const cor = (m: string) => CORES[sel.indexOf(m) % CORES.length]

  useEffect(() => {
    if (!sel.length) { setLinhas([]); return }
    let vivo = true
    setLinhas(null); setErro('')
    comparativo(sel, loja ? [loja] : null).then(r => vivo && setLinhas(r), e => vivo && setErro((e as Error).message))
    return () => { vivo = false }
  }, [sel.join(','), loja])

  // totais de cada mês (do resumo, inclui tudo)
  const totais = sel.map(m => {
    const ms = lojas.filter(l => !loja || l.cnpj === loja).map(l => l.meses.find(x => x.mes === m)).filter(Boolean) as { total: number; notas: number }[]
    const total = ms.reduce((s, x) => s + x.total, 0), notas = ms.reduce((s, x) => s + x.notas, 0)
    return { mes: m, total, notas, ticket: notas ? total / notas : 0 }
  })

  const produtos = useMemo(() => {
    const mapa = new Map<string, { cod: string; nome: string; por: Record<string, { v: number; q: number }> }>()
    for (const r of linhas || []) {
      if (!gorjeta && isGorjeta(r.xprod)) continue
      const k = r.cprod + '|' + r.xprod
      let p = mapa.get(k); if (!p) mapa.set(k, p = { cod: r.cprod, nome: r.xprod, por: {} })
      p.por[r.mes] = { v: r.valor, q: r.quantidade }
    }
    const t = q.trim().toLowerCase(), a = sel[0], b = sel[sel.length - 1]
    const val = (p: { por: Record<string, { v: number; q: number }> }, m: string) => p.por[m]?.[met] || 0
    const lista = [...mapa.values()].filter(p => !t || p.nome.toLowerCase().includes(t) || p.cod.toLowerCase() === t)
    const delta = (p: (typeof lista)[number]) => val(p, b) - val(p, a)
    return lista.sort((x, y) => ordem === 'maior' ? val(y, b) - val(x, b) : ordem === 'cresce' ? delta(y) - delta(x) : delta(x) - delta(y))
  }, [linhas, gorjeta, q, sel, met, ordem])

  const fmt = (v: number) => met === 'v' ? brl.format(v) : qf.format(v)
  const top = produtos.slice(0, 8).map(p => ({ nome: p.nome.length > 28 ? p.nome.slice(0, 27) + '…' : p.nome, ...Object.fromEntries(sel.map(m => [m, p.por[m]?.[met] || 0])) }))

  function exportar() {
    const cab = ['Código', 'Produto', ...sel.flatMap(m => [`${mesLabel(m)} qtd`, `${mesLabel(m)} R$`]), sel.length > 1 ? `Variação ${met === 'v' ? 'R$' : 'qtd'} %` : '']
    const a = sel[0], b = sel[sel.length - 1]
    const corpo = produtos.map(p => {
      const va = p.por[a]?.[met] || 0, vb = p.por[b]?.[met] || 0
      return [p.cod, p.nome, ...sel.flatMap(m => [String(p.por[m]?.q || 0).replace('.', ','), (p.por[m]?.v || 0).toFixed(2).replace('.', ',')]), va ? (((vb - va) / va) * 100).toFixed(1).replace('.', ',') : '']
    })
    baixar(`comparativo-${sel.join('_')}-${carimbo()}.csv`, csv([cab, ...corpo]), 'text/csv;charset=utf-8')
  }

  return (
    <div className="anim-entrar flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-full flex-col gap-1.5 text-xs font-medium text-muted sm:w-64">Loja
            <Select value={loja} onChange={e => setLoja(e.target.value)}>
              <option value="">Todas as lojas</option>
              {lojas.map(l => <option key={l.cnpj} value={l.cnpj}>{l.nome}</option>)}
            </Select>
          </label>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted">Comparar por
            <Segmented value={met} onChange={setMet} options={[['v', 'Receita'], ['q', 'Quantidade']]} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Meses <span className="font-normal">(clique para escolher; dá para comparar quantos quiser)</span></span>
          <div className="flex flex-wrap gap-1.5">
            {disponiveis.map(m => (
              <button key={m} onClick={() => toggle(m)} className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium', sel.includes(m) ? 'text-white' : 'border-line bg-surface hover:bg-surface-2')}
                style={sel.includes(m) ? { background: cor(m), borderColor: cor(m) } : undefined}>{mesLabel(m)}</button>
            ))}
          </div>
        </div>
      </Card>

      {!sel.length ? <Card><Empty icon={<CircleAlert className="size-6" />} title="Escolha pelo menos um mês">Selecione dois ou mais meses para comparar as vendas.</Empty></Card> : <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {totais.map((t, i) => (
            <Card key={t.mes} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium text-muted"><span className="size-2.5 rounded-full" style={{ background: cor(t.mes) }} />{mesLabel(t.mes)}</span>
                {i > 0 && <Variacao a={totais[i - 1].total} b={t.total} />}
              </div>
              <div className="num text-[24px] leading-none font-semibold tracking-tight">{brl.format(t.total)}</div>
              <div className="text-xs text-muted">{nf.format(t.notas)} notas · ticket {brl.format(t.ticket)}</div>
            </Card>
          ))}
        </div>

        {erro ? <Card><Empty icon={<CircleAlert className="size-6" />} title="Não foi possível comparar">{erro}</Empty></Card>
          : !linhas ? <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div> : <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
            <Card className="xl:col-span-2">
              <CardHeader title="Faturamento por mês" />
              <div className="p-3 pt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={totais.map(t => ({ mes: mesCurto(t.mes), total: t.total, cor: cor(t.mes) }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={c.grid} />
                    <XAxis dataKey="mes" tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} />
                    <YAxis tickFormatter={v => kf(+v)} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} width={40} />
                    <Tooltip cursor={{ fill: c.cursor }} formatter={v => brl.format(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12 }} />
                    <Bar dataKey="total" name="Faturamento" radius={[6, 6, 2, 2]} maxBarSize={64}
                      shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={6} fill={p.payload.cor} />} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="xl:col-span-3">
              <CardHeader title={`Top 8 produtos · ${met === 'v' ? 'receita' : 'quantidade'}`} hint={`Ordenados pelo último mês selecionado (${mesLabel(sel[sel.length - 1])})`} />
              <div className="p-3 pt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid horizontal={false} stroke={c.grid} />
                    <XAxis type="number" tickFormatter={v => met === 'v' ? kf(+v) : nf.format(+v)} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} />
                    <YAxis type="category" dataKey="nome" width={170} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} />
                    <Tooltip cursor={{ fill: c.cursor }} formatter={v => fmt(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12 }} />
                    <Legend formatter={v => mesLabel(String(v))} wrapperStyle={{ fontSize: 12 }} />
                    {sel.map(m => <Bar key={m} dataKey={m} name={m} fill={cor(m)} radius={[0, 4, 4, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Vendas por item <span className="font-normal text-muted">· {nf.format(produtos.length)} produtos</span></h2>
                <p className="text-xs text-muted">{sel.length > 1 ? `Variação: ${mesLabel(sel[sel.length - 1])} em relação a ${mesLabel(sel[0])}` : 'Escolha mais um mês para ver a variação'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar produto" className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface" />
                </label>
                <Select value={ordem} onChange={e => setOrdem(e.target.value as Ordem)} className="w-44">
                  <option value="maior">Mais vendidos</option><option value="cresce">Maior crescimento</option><option value="cai">Maior queda</option>
                </Select>
                <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-xs text-muted"><input type="checkbox" checked={gorjeta} onChange={e => setGorjeta(e.target.checked)} className="accent-[var(--accent)]" />Gorjeta</label>
                <Button onClick={exportar} disabled={!produtos.length}><FileSpreadsheet className="size-4" />CSV</Button>
              </div>
            </div>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 420 + sel.length * 130 }}>
                <thead>
                  <tr className="border-y border-line bg-surface-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    <th className="px-5 py-2.5">Produto</th>
                    {sel.map(m => <th key={m} className="px-3 py-2.5 text-right"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: cor(m) }} />{mesCurto(m)}</span></th>)}
                    {sel.length > 1 && <th className="px-5 py-2.5 text-right">Variação</th>}
                  </tr>
                </thead>
                <tbody>
                  {produtos.slice(0, mostrar).map(p => (
                    <tr key={p.cod + p.nome} className="border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="max-w-80 px-5 py-2.5"><div className="truncate font-medium">{p.nome}</div><div className="font-mono text-[11px] text-subtle">cód {p.cod}</div></td>
                      {sel.map(m => (
                        <td key={m} className="num px-3 py-2.5 text-right">
                          {p.por[m] ? <><div>{fmt(p.por[m][met])}</div><div className="text-[11px] text-muted">{met === 'v' ? qf.format(p.por[m].q) + ' un' : brl0.format(p.por[m].v)}</div></> : <span className="text-subtle">—</span>}
                        </td>
                      ))}
                      {sel.length > 1 && <td className="px-5 py-2.5 text-right"><Variacao a={p.por[sel[0]]?.[met] || 0} b={p.por[sel[sel.length - 1]]?.[met] || 0} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!produtos.length && <p className="py-12 text-center text-sm text-muted">Nenhum produto.</p>}
            </div>
            {produtos.length > mostrar && (
              <div className="border-t border-line p-3 text-center">
                <Button variant="ghost" onClick={() => setMostrar(m => m + 100)}>Mostrar mais ({nf.format(produtos.length - mostrar)} restantes)</Button>
              </div>
            )}
          </Card>
        </>}
      </>}
      {linhas === null && !erro && sel.length > 0 && <p className="flex items-center justify-center gap-2 text-xs text-muted"><LoaderCircle className="size-3.5 animate-spin" />Calculando no banco…</p>}
    </div>
  )
}
