import { ArrowUpRight, Receipt, Store, Ticket, Wallet } from 'lucide-react'
import type { Loja } from '../lib/data'
import { brl, brl0, cidade, fmtCnpj, kf, mesCurto, mesLabel, nf, pct } from '../lib/format'
import { Barras } from './charts'
import { Card, CardHeader, Kpi } from './ui'

export function Overview({ lojas, mes, setMes, abrirLoja }: { lojas: Loja[]; mes: string; setMes: (m: string) => void; abrirLoja: (cnpj: string) => void }) {
  const meses = [...new Set(lojas.flatMap(l => l.meses.map(m => m.mes)))].sort()
  const val = (l: Loja, m: string) => l.meses.find(x => x.mes === m) || { total: 0, notas: 0 }
  const lin = lojas.map(l => {
    const ms = mes ? [val(l, mes)] : l.meses
    return { l, total: ms.reduce((s, x) => s + x.total, 0), notas: ms.reduce((s, x) => s + x.notas, 0) }
  }).sort((a, b) => b.total - a.total)
  const T = lin.reduce((s, x) => s + x.total, 0), N = lin.reduce((s, x) => s + x.notas, 0)
  const porMes = meses.map(m => {
    const v = lojas.reduce((s, l) => s + val(l, m).total, 0), n = lojas.reduce((s, l) => s + val(l, m).notas, 0)
    return { key: m, label: mesCurto(m), value: v, tip: <><b>{mesLabel(m)}</b><div className="num">{brl.format(v)}</div><div className="text-muted">{nf.format(n)} notas</div></> }
  })
  const lmx = Math.max(1, ...lin.map(x => x.total))
  const hmx = Math.max(1, ...lojas.flatMap(l => l.meses.map(x => x.total)))
  const periodo = mes ? mesLabel(mes) : meses.length ? `${mesLabel(meses[0])} a ${mesLabel(meses[meses.length - 1])}` : ''

  return (
    <div className="anim-entrar flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Faturamento" value={brl.format(T)} sub={periodo} icon={<Wallet className="size-4" />} tone="accent" />
        <Kpi label="Notas autorizadas" value={nf.format(N)} sub={`${lojas.length} ${lojas.length === 1 ? 'loja' : 'lojas'}`} icon={<Receipt className="size-4" />} />
        <Kpi label="Ticket médio" value={brl.format(N ? T / N : 0)} sub="todas as lojas" icon={<Ticket className="size-4" />} />
        <Kpi label="Maior loja" value={lin[0]?.l.loja || '—'} sub={lin[0] ? pct(lin[0].total / (T || 1)) + ' do faturamento' : ''} icon={<Store className="size-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Faturamento por mês" hint={mes ? 'Clique no mês de novo para ver todos' : 'Clique em um mês para filtrar'} />
          <div className="p-3 pt-4">
            <Barras data={porMes} selecionado={mes || null} onSelect={k => setMes(k === mes ? '' : k)} altura={260} />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Ranking de lojas" hint="Clique para abrir a loja" />
          <ul className="flex flex-col p-2">
            {lin.map((x, i) => (
              <li key={x.l.cnpj}>
                <button onClick={() => abrirLoja(x.l.cnpj)} className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
                  <span className="num w-5 text-xs text-subtle">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{x.l.loja} <span className="font-normal text-muted">· {cidade(x.l.end)}</span></span>
                      <span className="num text-sm font-semibold">{brl0.format(x.total)}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${(x.total / lmx) * 100}%` }} /></div>
                  </div>
                  <ArrowUpRight className="size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Lojas × meses" hint="Faturamento mensal de cada loja" />
        <div className="scroll-thin overflow-x-auto p-5 pt-4">
          <div className="grid gap-1 text-xs" style={{ gridTemplateColumns: `minmax(180px,1.6fr) repeat(${meses.length}, minmax(76px,1fr)) minmax(90px,1fr)`, minWidth: 280 + meses.length * 84 }}>
            <div className="px-2 py-1.5 font-semibold text-muted">Loja</div>
            {meses.map(m => <div key={m} className="px-2 py-1.5 text-right font-semibold text-muted">{mesCurto(m)}</div>)}
            <div className="px-2 py-1.5 text-right font-semibold text-muted">Total</div>
            {lin.map(x => [
              <button key="n" onClick={() => abrirLoja(x.l.cnpj)} className="cursor-pointer truncate rounded-lg px-2 py-2 text-left font-medium hover:bg-surface-2">
                {x.l.loja} <span className="font-mono text-subtle">{fmtCnpj(x.l.cnpj).slice(-8)}</span>
              </button>,
              ...meses.map(m => {
                const v = val(x.l, m)
                return (
                  <div key={m} title={`${nf.format(v.notas)} notas`} className="num rounded-lg px-2 py-2 text-right"
                    style={{ background: v.total ? `color-mix(in oklab, var(--accent) ${Math.round(8 + (v.total / hmx) * 52)}%, transparent)` : undefined }}>
                    {v.total ? kf(v.total) : <span className="text-subtle">—</span>}
                  </div>
                )
              }),
              <div key="t" className="num px-2 py-2 text-right font-semibold">{kf(x.l.meses.reduce((s, y) => s + y.total, 0))}</div>,
            ])}
          </div>
        </div>
      </Card>
    </div>
  )
}
