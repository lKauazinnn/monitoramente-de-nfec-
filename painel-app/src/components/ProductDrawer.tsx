import { useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Clock, Package, Receipt, X } from 'lucide-react'
import { CUT, type Note } from '../lib/data'
import { brl, dayLabel, nf, qf } from '../lib/format'
import { Barras, PaletaCtx } from './charts'
import { Segmented } from './ui'

type Metrica = 'v' | 'q'
const ordem = (h: number) => h < CUT ? h + 24 : h
const hh = (h: number) => String(h).padStart(2, '0') + 'h'

export function ProductDrawer({ prod, nome, cod, notes, metricaInicial, periodo, onClose }: {
  prod: number; nome: string; cod: string; notes: Note[]; metricaInicial: Metrica; periodo: string; onClose: () => void
}) {
  const [met, setMet] = useState<Metrica>(metricaInicial)
  const c = useContext(PaletaCtx)

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])

  const d = useMemo(() => {
    const hrs: Record<number, { v: number; q: number; n: number }> = {}
    const dias: Record<string, { v: number; q: number; n: number }> = {}
    let v = 0, q = 0, n = 0
    for (const nt of notes) {
      let nv = 0, nq = 0
      for (const i of nt.items) if (i.p === prod) { nv += i.v - i.d; nq += i.q }
      if (!nq && !nv) continue
      v += nv; q += nq; n++
      const h = (hrs[nt.hour] ||= { v: 0, q: 0, n: 0 }); h.v += nv; h.q += nq; h.n++
      const dd = (dias[nt.od] ||= { v: 0, q: 0, n: 0 }); dd.v += nv; dd.q += nq; dd.n++
    }
    return { hrs, dias, v, q, n }
  }, [notes, prod])

  const fmt = (x: { v: number; q: number }) => met === 'v' ? brl.format(x.v) : qf.format(x.q) + ' un'
  const dica = (titulo: string, x: { v: number; q: number; n: number }) =>
    <><b>{titulo}</b><div className="num">{brl.format(x.v)}</div><div className="text-muted">{qf.format(x.q)} un · {nf.format(x.n)} notas</div></>

  const hk = Object.keys(d.hrs).map(Number)
  const horas: number[] = []
  if (hk.length) for (let h = Math.min(...hk.map(ordem)); h <= Math.max(...hk.map(ordem)); h++) horas.push(h % 24)
  const picoH = hk.slice().sort((a, b) => d.hrs[b][met] - d.hrs[a][met])[0]
  const porHora = horas.map(h => {
    const x = d.hrs[h] || { v: 0, q: 0, n: 0 }
    return { key: String(h), label: String(h).padStart(2, '0'), value: x[met], destaque: h === picoH, tip: dica(hh(h), x) }
  })

  const dk = Object.keys(d.dias).sort()
  const picoD = dk.slice().sort((a, b) => d.dias[b][met] - d.dias[a][met])[0]
  const porDia = dk.map(k => {
    const x = d.dias[k], l = dayLabel(k)
    return { key: k, label: k.slice(8, 10), value: x[met], destaque: k === picoD, tip: dica(`${l.wd} ${l.dm}`, x) }
  })
  const cor = (p: { destaque?: boolean }) => p.destaque ? c.accent : c.ink

  const destaques = [
    { icon: <Clock className="size-4" />, label: 'Horário de pico', valor: picoH !== undefined ? `${hh(picoH)} – ${hh((picoH + 1) % 24)}` : '—', sub: picoH !== undefined ? `${fmt(d.hrs[picoH])} · ${nf.format(d.hrs[picoH].n)} notas` : '' },
    { icon: <CalendarDays className="size-4" />, label: 'Dia de pico', valor: picoD ? `${dayLabel(picoD).wd} ${dayLabel(picoD).dm}` : '—', sub: picoD ? `${fmt(d.dias[picoD])} · ${nf.format(d.dias[picoD].n)} notas` : '' },
  ]

  return createPortal(
    <>
      <div className="anim-fade fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="anim-gaveta fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l border-line bg-surface shadow-2xl" role="dialog" aria-label={nome}>
        <header className="flex items-start justify-between gap-3 border-b border-line p-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><Package className="size-5" /></span>
            <div className="min-w-0">
              <span className="font-mono text-[11px] tracking-wider text-muted uppercase">Produto · cód {cod} · {periodo}</span>
              <h2 className="mt-0.5 text-xl leading-tight font-semibold tracking-tight">{nome}</h2>
            </div>
          </div>
          <button aria-label="Fechar" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-5" /></button>
        </header>

        <div className="scroll-thin flex flex-1 flex-col gap-5 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-3">
            {[['Receita', brl.format(d.v)], ['Quantidade', qf.format(d.q) + ' un'], ['Notas com o item', nf.format(d.n)]].map(([l, v]) => (
              <div key={l} className="rounded-xl bg-surface-2 p-3.5">
                <div className="text-xs text-muted">{l}</div>
                <div className="num mt-1 truncate text-lg font-semibold tracking-tight">{v}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {destaques.map(x => (
              <div key={x.label} className="flex items-center gap-3 rounded-xl border border-line p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-white">{x.icon}</span>
                <div className="min-w-0">
                  <div className="text-xs text-muted">{x.label}</div>
                  <div className="text-lg leading-tight font-semibold tracking-tight">{x.valor}</div>
                  <div className="num truncate text-xs text-muted">{x.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Pico calculado por</span>
            <Segmented size="sm" value={met} onChange={setMet} options={[['v', 'Receita'], ['q', 'Quantidade']]} />
          </div>

          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-muted" />Vendas por hora</h3>
            <p className="text-xs text-muted">Horário da emissão da nota · em destaque o pico</p>
            <div className="-mx-2 mt-2"><Barras data={porHora} altura={220} cor={cor} /></div>
          </section>

          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Receipt className="size-4 text-muted" />Vendas por dia</h3>
            <p className="text-xs text-muted">Dia operacional (vira às {String(CUT).padStart(2, '0')}h) · em destaque o pico</p>
            <div className="-mx-2 mt-2"><Barras data={porDia} altura={220} cor={cor} /></div>
          </section>
        </div>
      </aside>
    </>,
    document.body,
  )
}
