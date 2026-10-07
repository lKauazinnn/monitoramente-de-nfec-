import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { Note } from '../lib/data'
import { brl, nf, payName } from '../lib/format'
import { Badge, Button, Card } from './ui'

const POR_PAGINA = 25

export function NotesTable({ notes, prods, onOpen }: { notes: Note[]; prods: [string, string][]; onOpen: (n: Note) => void }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (t ? notes.filter(n => String(n.n).includes(t) || n.ref.toLowerCase().includes(t) || n.chave.includes(t) ||
      n.items.some(i => ((prods[i.p] || [])[1] || '').toLowerCase().includes(t))) : notes)
      .slice().sort((a, b) => b.dh.localeCompare(a.dh) || b.n - a.n)
  }, [notes, prods, q])
  const pages = Math.max(1, Math.ceil(lista.length / POR_PAGINA)), pg = Math.min(page, pages - 1)
  const dt = (n: Note) => `${n.dh.slice(8, 10)}/${n.dh.slice(5, 7)} ${n.dh.slice(11, 16)}`

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">Notas emitidas <span className="font-normal text-muted">· {nf.format(lista.length)}</span></h2>
        <label className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => { setQ(e.target.value); setPage(0) }} placeholder="Nº da nota, ficha, produto ou chave"
            className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface" />
        </label>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
              <th className="px-5 py-2.5">Nº</th><th className="px-3 py-2.5">Emissão</th><th className="px-3 py-2.5">Canal</th><th className="px-3 py-2.5">Ref.</th>
              <th className="px-3 py-2.5">Pagamento</th><th className="px-3 py-2.5 text-right">Itens</th><th className="px-5 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lista.slice(pg * POR_PAGINA, (pg + 1) * POR_PAGINA).map(n => (
              <tr key={n.chave} onClick={() => onOpen(n)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-5 py-3 font-mono text-xs">{n.n}</td>
                <td className="px-3 py-3 font-mono text-xs text-muted">{dt(n)}</td>
                <td className="px-3 py-3"><Badge tone={n.canal === 'entrega' ? 'ok' : 'accent'}>{n.canal === 'entrega' ? 'Entrega' : 'Salão'}</Badge></td>
                <td className="px-3 py-3 text-muted">{n.ref}</td>
                <td className="max-w-56 truncate px-3 py-3">{n.pays.map(p => payName(p.c)).join(' + ')}</td>
                <td className="num px-3 py-3 text-right text-muted">{n.items.length}</td>
                <td className="num px-5 py-3 text-right font-semibold">{brl.format(n.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!lista.length && <p className="py-12 text-center text-sm text-muted">Nenhuma nota encontrada.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
        <span>Página {pg + 1} de {pages}</span>
        <div className="flex gap-2">
          <Button size="sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><ChevronLeft className="size-4" />Anterior</Button>
          <Button size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Próxima<ChevronRight className="size-4" /></Button>
        </div>
      </div>
    </Card>
  )
}
