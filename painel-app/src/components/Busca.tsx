import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, CircleAlert, FileCode2, FileDown, FileSpreadsheet, LoaderCircle, RotateCcw, Search, SlidersHorizontal } from 'lucide-react'
import type { Loja } from '../lib/data'
import { baixarCsv, baixarPdfs, baixarXmlsZip, buscar, buscarTodas, filtrosVazios, paraNota, venda, type Filtros, type NotaBusca, type Ordem } from '../lib/busca'
import { brl, nf, PAY, payName } from '../lib/format'
import { NoteDrawer } from './NoteDrawer'
import { useToast } from './Toast'
import { Badge, Button, Card, Empty, Segmented, Select, cx } from './ui'

const POR_PAGINA = 50
const LIMITE = { xml: 20000, pdf: 500, csv: 100000 }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function periodo(k: string): [string, string] {
  const h = new Date(), d = (n: number) => { const x = new Date(h); x.setDate(x.getDate() - n); return iso(x) }
  if (k === 'hoje') return [iso(h), iso(h)]
  if (k === 'ontem') return [d(1), d(1)]
  if (k === '7') return [d(6), iso(h)]
  if (k === '30') return [d(29), iso(h)]
  if (k === 'mes') return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)]
  return [iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), iso(new Date(h.getFullYear(), h.getMonth(), 0))]
}
const PRESETS: [string, string][] = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['ant', 'Mês passado']]
const campo = 'h-10 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface'

function Rotulo({ t, children, className }: { t: string; children: ReactNode; className?: string }) {
  return <label className={cx('flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted', className)}>{t}{children}</label>
}

export function Busca({ lojas }: { lojas: Loja[] }) {
  const toast = useToast()
  const [f, setF] = useState<Filtros>(filtrosVazios)
  const [aplicado, setAplicado] = useState<Filtros>(filtrosVazios)
  const [res, setRes] = useState<{ notas: NotaBusca[]; total: number; soma: number } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState<Map<string, NotaBusca>>(new Map())
  const [todos, setTodos] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [porItem, setPorItem] = useState(false)
  const [aberta, setAberta] = useState<NotaBusca | null>(null)
  const nome = useMemo(() => { const m = new Map(lojas.map(l => [l.cnpj, l.nome])); return (c: string) => m.get(c) || c }, [lojas])

  const carregar = useCallback(async (filtros: Filtros, p: number) => {
    setCarregando(true); setErro('')
    try { setRes(await buscar(filtros, p, POR_PAGINA)); setPagina(p) }
    catch (e) { setErro((e as Error).message) }
    setCarregando(false)
  }, [])
  useEffect(() => { carregar(filtrosVazios(), 0) }, [carregar])

  function aplicar(e?: FormEvent) {
    e?.preventDefault()
    setAplicado(f); setSel(new Map()); setTodos(false); carregar(f, 0)
  }
  function limpar() { const v = filtrosVazios(); setF(v); setAplicado(v); setSel(new Map()); setTodos(false); carregar(v, 0) }
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setF(x => ({ ...x, [k]: v }))
  const toggleLoja = (c: string) => set('cnpjs', f.cnpjs.includes(c) ? f.cnpjs.filter(x => x !== c) : [...f.cnpjs, c])

  const notas = res?.notas || []
  const todasNaPagina = notas.length > 0 && notas.every(n => sel.has(n.chave))
  const qtdSel = todos ? res?.total || 0 : sel.size

  async function baixarLote(tipo: 'xml' | 'pdf' | 'csv') {
    if (!res?.total) return
    const usar = qtdSel ? qtdSel : res.total
    if (usar > LIMITE[tipo]) return toast(`Para ${tipo.toUpperCase()}, o limite é ${nf.format(LIMITE[tipo])} notas por download. Filtre um período menor ou selecione menos notas.`, { tone: 'erro' })
    if (!qtdSel && usar > 200 && !confirm(`Nenhuma nota selecionada: baixar as ${nf.format(usar)} notas do resultado?`)) return
    setBaixando(true)
    try {
      const prog = (m: string) => toast(m, { tone: 'carregando' })
      const lista = !todos && sel.size
        ? [...sel.values()]
        : await buscarTodas(aplicado, usar, n => prog(`Lendo notas… ${nf.format(n)} de ${nf.format(usar)}`))
      if (tipo === 'csv') { baixarCsv(lista, porItem, nome); toast(`CSV com ${nf.format(lista.length)} notas gerado.`, { tone: 'ok' }) }
      else {
        const r = tipo === 'xml' ? await baixarXmlsZip(lista, nome, prog) : await baixarPdfs(lista, prog)
        toast(<>{tipo === 'xml' ? 'ZIP' : 'PDF'} gerado com {nf.format(lista.length)} notas.{r.semXml > 0 && <span className="text-warn"> {nf.format(r.semXml)} sem XML no banco{tipo === 'pdf' ? ' (saíram como espelho)' : ' (listadas em notas-sem-xml.txt)'}.</span>}</>, { tone: 'ok', fixo: r.semXml > 0 })
      }
    } catch (e) { toast('Erro no download: ' + (e as Error).message, { tone: 'erro' }) }
    setBaixando(false)
  }

  const paginas = Math.max(1, Math.ceil((res?.total || 0) / POR_PAGINA))
  const dt = (n: NotaBusca) => `${n.dh.slice(8, 10)}/${n.dh.slice(5, 7)}/${n.dh.slice(0, 4)} ${n.dh.slice(11, 16)}`
  const ativos = (Object.keys(aplicado) as (keyof Filtros)[]).filter(k => k !== 'ordem' && (Array.isArray(aplicado[k]) ? (aplicado[k] as string[]).length : aplicado[k])).length
  const drawer = aberta ? paraNota(aberta) : null

  return (
    <div className="anim-entrar flex flex-col gap-5">
      <Card>
        <form onSubmit={aplicar} className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><SlidersHorizontal className="size-4 text-muted" />Filtros</h2>
            {ativos > 0 && <Badge tone="accent">{ativos} {ativos === 1 ? 'filtro ativo' : 'filtros ativos'}</Badge>}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Lojas</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => set('cnpjs', [])} className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium', !f.cnpjs.length ? 'border-fg bg-fg text-bg' : 'border-line bg-surface hover:bg-surface-2')}>Todas</button>
              {lojas.map(l => (
                <button type="button" key={l.cnpj} onClick={() => toggleLoja(l.cnpj)} className={cx('cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium', f.cnpjs.includes(l.cnpj) ? 'border-accent bg-accent text-white' : 'border-line bg-surface hover:bg-surface-2')}>{l.nome}</button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Rotulo t="De" className="w-40"><input type="date" className={campo} value={f.de} max={f.ate || undefined} onChange={e => set('de', e.target.value)} /></Rotulo>
            <Rotulo t="Até" className="w-40"><input type="date" className={campo} value={f.ate} min={f.de || undefined} onChange={e => set('ate', e.target.value)} /></Rotulo>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {PRESETS.map(([k, l]) => <Button key={k} type="button" size="sm" variant="ghost" className="border border-line" onClick={() => { const [de, ate] = periodo(k); setF(x => ({ ...x, de, ate })) }}><CalendarRange className="size-3.5" />{l}</Button>)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Rotulo t="Produto (nome ou código)"><input className={campo} value={f.produto} onChange={e => set('produto', e.target.value)} placeholder="ex.: chopp" /></Rotulo>
            <Rotulo t="Nº da nota"><input className={campo} inputMode="numeric" value={f.numero} onChange={e => set('numero', e.target.value)} placeholder="ex.: 27599" /></Rotulo>
            <Rotulo t="Chave de acesso (início)"><input className={campo + ' font-mono'} inputMode="numeric" value={f.chave} onChange={e => set('chave', e.target.value)} placeholder="3526…" /></Rotulo>
            <Rotulo t="Forma de pagamento">
              <Select value={f.pagamento} onChange={e => set('pagamento', e.target.value)}>
                <option value="">Todas</option>
                {Object.entries(PAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Rotulo>
            <Rotulo t="Valor da nota (R$)">
              <div className="flex items-center gap-2">
                <input className={campo} inputMode="decimal" value={f.min} onChange={e => set('min', e.target.value)} placeholder="mín." />
                <span className="text-subtle">–</span>
                <input className={campo} inputMode="decimal" value={f.max} onChange={e => set('max', e.target.value)} placeholder="máx." />
              </div>
            </Rotulo>
            <Rotulo t="Canal"><Segmented value={f.canal} onChange={v => set('canal', v)} options={[['', 'Todos'], ['salao', 'Salão'], ['entrega', 'Entrega']]} /></Rotulo>
            <Rotulo t="Ordenar por">
              <Select value={f.ordem} onChange={e => set('ordem', e.target.value as Ordem)}>
                <option value="recentes">Mais recentes</option><option value="antigas">Mais antigas</option>
                <option value="maior_valor">Maior valor</option><option value="menor_valor">Menor valor</option>
              </Select>
            </Rotulo>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="primary" className="flex-1" disabled={carregando}>{carregando ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}Buscar</Button>
              <Button type="button" onClick={limpar} title="Limpar filtros"><RotateCcw className="size-4" /></Button>
            </div>
          </div>
        </form>
      </Card>

      {erro ? <Card><Empty icon={<CircleAlert className="size-6" />} title="Não foi possível buscar">{erro}</Empty></Card> : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">{res ? `${nf.format(res.total)} notas` : 'Buscando…'} {res && res.total > 0 && <span className="font-normal text-muted">· {brl.format(res.soma)}</span>}</h2>
              <p className="text-xs text-muted">
                {qtdSel ? <>{nf.format(qtdSel)} selecionada{qtdSel > 1 ? 's' : ''} · <button className="cursor-pointer text-accent hover:underline" onClick={() => { setSel(new Map()); setTodos(false) }}>limpar seleção</button></> : 'Sem seleção: os downloads usam todas as notas do resultado.'}
                {!todos && todasNaPagina && res && res.total > notas.length && <> · <button className="cursor-pointer font-medium text-accent hover:underline" onClick={() => setTodos(true)}>selecionar todas as {nf.format(res.total)}</button></>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => baixarLote('xml')} disabled={baixando || !res?.total}><FileCode2 className="size-4" />XML (.zip)</Button>
              <Button onClick={() => baixarLote('pdf')} disabled={baixando || !res?.total}><FileDown className="size-4" />PDF</Button>
              <div className="flex items-center rounded-xl border border-line">
                <Button variant="ghost" onClick={() => baixarLote('csv')} disabled={baixando || !res?.total} className="rounded-r-none"><FileSpreadsheet className="size-4" />CSV</Button>
                <label className="flex h-10 cursor-pointer items-center gap-1.5 border-l border-line px-3 text-xs text-muted"><input type="checkbox" checked={porItem} onChange={e => setPorItem(e.target.checked)} className="accent-[var(--accent)]" />1 linha por item</label>
              </div>
            </div>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="w-10 px-5 py-2.5"><input type="checkbox" aria-label="Selecionar página" checked={todos || todasNaPagina} onChange={e => { setTodos(false); setSel(s => { const m = new Map(s); notas.forEach(x => e.target.checked ? m.set(x.chave, x) : m.delete(x.chave)); return m }) }} className="accent-[var(--accent)]" /></th>
                  <th className="px-3 py-2.5">Loja</th><th className="px-3 py-2.5">Nº</th><th className="px-3 py-2.5">Emissão</th><th className="px-3 py-2.5">Canal</th>
                  <th className="px-3 py-2.5">Pagamento</th><th className="px-3 py-2.5 text-right">Itens</th><th className="px-5 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className={cx(carregando && 'opacity-50')}>
                {notas.map(n => {
                  const v = venda(n.info)
                  return (
                    <tr key={n.chave} onClick={() => setAberta(n)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Selecionar nota ${n.n}`} checked={todos || sel.has(n.chave)} className="accent-[var(--accent)]"
                          onChange={e => { setTodos(false); setSel(s => { const m = new Map(todos ? notas.map(y => [y.chave, y] as const) : s); e.target.checked ? m.set(n.chave, n) : m.delete(n.chave); return m }) }} />
                      </td>
                      <td className="max-w-48 truncate px-3 py-3">{nome(n.cnpj)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{n.n}</td>
                      <td className="px-3 py-3 font-mono text-xs text-muted">{dt(n)}</td>
                      <td className="px-3 py-3"><Badge tone={v.canal === 'entrega' ? 'ok' : 'accent'}>{v.canal === 'entrega' ? 'Entrega' : 'Salão'}</Badge> <span className="text-xs text-muted">{v.ref}</span></td>
                      <td className="max-w-56 truncate px-3 py-3">{n.pagamentos.map(p => payName(p[0])).join(' + ')}</td>
                      <td className="num px-3 py-3 text-right text-muted">{n.itens.length}</td>
                      <td className="num px-5 py-3 text-right font-semibold">{brl.format(+n.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {res && !notas.length && <p className="py-14 text-center text-sm text-muted">Nenhuma nota com esses filtros.</p>}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
            <span>Página {pagina + 1} de {nf.format(paginas)}</span>
            <div className="flex gap-2">
              <Button size="sm" disabled={pagina === 0 || carregando} onClick={() => carregar(aplicado, pagina - 1)}><ChevronLeft className="size-4" />Anterior</Button>
              <Button size="sm" disabled={pagina >= paginas - 1 || carregando} onClick={() => carregar(aplicado, pagina + 1)}>Próxima<ChevronRight className="size-4" /></Button>
            </div>
          </div>
        </Card>
      )}
      {drawer && <NoteDrawer note={drawer.note} mes={drawer.mes} onClose={() => setAberta(null)} />}
    </div>
  )
}
