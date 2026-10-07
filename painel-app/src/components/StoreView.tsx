import { useContext, useEffect, useMemo, useState } from 'react'
import { BadgePercent, CalendarDays, ChartColumn, CircleAlert, HandCoins, Landmark, Receipt, Ticket, Wallet, X } from 'lucide-react'
import { CUT, loadMes, type Loja, type Mes, type Note } from '../lib/data'
import { brl, brl0, dayLabel, mesLabel, nf, payColor, payName, pct, qf, qf1, sum } from '../lib/format'
import { Barras, PaletaCtx, Rosca } from './charts'
import { NoteDrawer } from './NoteDrawer'
import { NotesTable } from './NotesTable'
import { ProductDrawer } from './ProductDrawer'
import { Badge, Button, Card, CardHeader, Empty, Kpi, Segmented, Skeleton } from './ui'

type Canal = 'all' | 'salao' | 'entrega'

export function StoreView({ loja, mes }: { loja: Loja; mes: string }) {
  const [D, setD] = useState<Mes | null>(null)
  const [erro, setErro] = useState('')
  const [canal, setCanal] = useState<Canal>('all')
  const [day, setDay] = useState<string | null>(null)
  const [sort, setSort] = useState<'v' | 'q'>('v')
  const [sel, setSel] = useState<Note | null>(null)
  const [prod, setProd] = useState<number | null>(null)
  const c = useContext(PaletaCtx)

  useEffect(() => {
    let vivo = true
    loadMes(loja.cnpj, mes).then(d => vivo && setD(d), e => vivo && setErro((e as Error).message))
    return () => { vivo = false }
  }, [loja.cnpj, mes])

  const calc = useMemo(() => {
    if (!D) return null
    const byCanal = D.notes.filter(n => canal === 'all' || n.canal === canal)
    const days = [...new Set(D.notes.map(n => n.od))].sort()
    const f = byCanal.filter(n => !day || n.od === day)
    const rev = sum(f, n => n.total), desc = sum(f, n => n.desc), icms = sum(f, n => n.icms), gorj = sum(f, n => n.gorj)
    const nItems = sum(f, n => sum(n.items.filter(i => !i.g), i => i.q))

    const porDia = days.map(d => {
      const a = byCanal.filter(n => n.od === d), v = sum(a, n => n.total), l = dayLabel(d)
      return { key: d, label: d.slice(8, 10), value: v, tip: <><b>{l.wd} {l.dm}</b><div className="num">{brl.format(v)}</div><div className="text-muted">{nf.format(a.length)} notas</div></> }
    })

    const hrs: Record<number, { v: number; c: number }> = {}
    f.forEach(n => { (hrs[n.hour] ||= { v: 0, c: 0 }); hrs[n.hour].v += n.total; hrs[n.hour].c++ })
    const hk = Object.keys(hrs).map(Number), ordem = (h: number) => h < CUT ? h + 24 : h
    const horas: number[] = []
    if (hk.length) for (let h = Math.min(...hk.map(ordem)); h <= Math.max(...hk.map(ordem)); h++) horas.push(h % 24)
    const pico = hk.slice().sort((a, b) => hrs[b].v - hrs[a].v)[0]
    const porHora = horas.map(h => {
      const x = hrs[h] || { v: 0, c: 0 }, hh = String(h).padStart(2, '0')
      return { key: String(h), label: hh, value: x.v, destaque: h === pico, tip: <><b>{hh}h</b><div className="num">{brl.format(x.v)}</div><div className="text-muted">{nf.format(x.c)} notas</div></> }
    })

    const pa: Record<string, { v: number; c: number }> = {}
    f.forEach(n => n.pays.forEach(p => { (pa[p.c] ||= { v: 0, c: 0 }); pa[p.c].v += p.v; pa[p.c].c++ }))
    const pays = Object.entries(pa).sort((a, b) => b[1].v - a[1].v)
    const ptot = sum(pays, ([, x]) => x.v) || 1

    const escopo = D.notes.filter(n => !day || n.od === day)
    const canais = (['salao', 'entrega'] as const).map(k => { const a = escopo.filter(n => n.canal === k); return { k, n: a.length, v: sum(a, n => n.total) } })

    const pm: Record<number, { q: number; v: number }> = {}
    f.forEach(n => n.items.forEach(i => { if (i.g) return; (pm[i.p] ||= { q: 0, v: 0 }); pm[i.p].q += i.q; pm[i.p].v += i.v - i.d }))
    return { f, days, rev, desc, icms, gorj, nItems, porDia, porHora, pico, pays, ptot, canais, pm }
  }, [D, canal, day])

  if (erro) return <Card><Empty icon={<CircleAlert className="size-6" />} title="Não foi possível abrir este mês">{erro}</Empty></Card>
  if (!D || !calc) return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
    </div>
  )

  const { f, days, rev, desc, icms, gorj, nItems, porDia, porHora, pico, pays, ptot, canais, pm } = calc
  const produtos = Object.entries(pm).sort((a, b) => b[1][sort] - a[1][sort]).slice(0, 12)
  const pmax = produtos.length ? produtos[0][1][sort] : 1
  const dl = day ? dayLabel(day) : null

  return (
    <div className="anim-entrar flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Canal> value={canal} onChange={setCanal} options={[['all', 'Todos os canais'], ['salao', 'Salão'], ['entrega', 'Entrega']]} />
        <div className="flex items-center gap-2">
          {dl
            ? <Button size="sm" variant="secondary" onClick={() => setDay(null)}><CalendarDays className="size-3.5" />{dl.wd} {dl.dm}<X className="size-3.5 text-muted" /></Button>
            : <span className="text-xs text-muted">{mesLabel(mes)} · {days.length} dias com venda · clique em um dia no gráfico para filtrar</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Faturamento" value={brl.format(rev)} sub={day ? `${dl!.wd} ${dl!.dm}` : `média ${brl0.format(rev / Math.max(days.length, 1))}/dia`} icon={<Wallet className="size-4" />} tone="accent" />
        <Kpi label="Notas autorizadas" value={nf.format(f.length)} sub={!day && D.lacunas ? <span className="text-warn">{nf.format(D.lacunas)} lacunas na numeração</span> : 'sem lacunas no período'} icon={<Receipt className="size-4" />} />
        <Kpi label="Ticket médio" value={brl.format(f.length ? rev / f.length : 0)} sub={`${qf1.format(f.length ? nItems / f.length : 0)} itens por nota`} icon={<Ticket className="size-4" />} />
        <Kpi label="Gorjeta / serviço" value={brl.format(gorj)} sub={pct(rev ? gorj / rev : 0) + ' do faturamento'} icon={<HandCoins className="size-4" />} />
        <Kpi label="Descontos" value={brl.format(desc)} sub={pct(rev ? desc / (rev + desc) : 0) + ' do bruto'} icon={<BadgePercent className="size-4" />} />
        <Kpi label="ICMS destacado" value={brl.format(icms)} sub={pct(rev ? icms / rev : 0) + ' do faturamento'} icon={<Landmark className="size-4" />} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Faturamento por dia" hint={`Dia operacional vira às ${String(CUT).padStart(2, '0')}h`} />
          <div className="p-3 pt-4"><Barras data={porDia} selecionado={day} onSelect={k => setDay(k === day ? null : k)} altura={260} /></div>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Movimento por hora" hint={pico !== undefined ? `Pico às ${String(pico).padStart(2, '0')}h` : ''} />
          <div className="p-3 pt-4"><Barras data={porHora} altura={260} cor={p => p.destaque ? c.accent : c.ink} /></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Formas de pagamento" />
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
            <Rosca total={ptot} data={pays.map(([k, x]) => ({ name: payName(k), value: x.v, color: payColor(k) }))} />
            <ul className="flex min-w-0 flex-1 flex-col">
              {pays.map(([k, x]) => (
                <li key={k} className="flex items-center gap-3 border-b border-line py-2 text-sm last:border-0">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: payColor(k) }} />
                  <span className="min-w-0 flex-1 truncate">{payName(k)} <span className="text-xs text-muted">· {nf.format(x.c)}</span></span>
                  <span className="num font-medium">{brl.format(x.v)}</span>
                  <span className="num w-12 text-right text-xs text-muted">{pct(x.v / ptot)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            {canais.map(x => (
              <div key={x.k} className="rounded-xl bg-surface-2 p-4">
                <div className="flex items-center justify-between"><span className="text-xs text-muted">{x.k === 'salao' ? 'Salão' : 'Entrega'}</span><Badge tone={x.k === 'salao' ? 'accent' : 'ok'}>{nf.format(x.n)} notas</Badge></div>
                <div className="num mt-2 text-xl font-semibold tracking-tight">{brl0.format(x.v)}</div>
                <div className="num text-xs text-muted">ticket médio {brl0.format(x.n ? x.v / x.n : 0)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Produtos mais vendidos" hint="Clique em um produto para ver o horário e o dia de pico" action={<Segmented size="sm" value={sort} onChange={setSort} options={[['v', 'Receita'], ['q', 'Quantidade']]} />} />
          <ol className="flex flex-col p-3 pt-2">
            {produtos.map(([p, x], i) => (
              <li key={p}>
               <button onClick={() => setProd(+p)} className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2">
                <span className="num w-5 text-xs text-subtle">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{(D.prods[+p] || [])[1]}</span>
                    <span className="num shrink-0 font-medium">{sort === 'v' ? brl.format(x.v) : qf.format(x.q) + ' un'}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${(x[sort] / pmax) * 100}%` }} /></div>
                </div>
                <ChartColumn className="size-4 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
               </button>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <NotesTable key={canal + (day || '')} notes={f} prods={D.prods} onOpen={setSel} />
      {sel && <NoteDrawer note={sel} mes={D} onClose={() => setSel(null)} />}
      {prod !== null && (
        <ProductDrawer prod={prod} nome={(D.prods[prod] || [])[1]} cod={(D.prods[prod] || [])[0]} notes={f} metricaInicial={sort} onClose={() => setProd(null)}
          periodo={[day ? `${dl!.wd} ${dl!.dm}` : mesLabel(mes), canal === 'salao' ? 'salão' : canal === 'entrega' ? 'entrega' : ''].filter(Boolean).join(' · ')} />
      )}
    </div>
  )
}
