import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, FileCode2, FileDown, FileSpreadsheet, LoaderCircle, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Loja } from '../lib/data'
import { baixarCsv, baixarPdfs, baixarXmlsZip, buscar, buscarTodas, filtrosVazios, paraNota, venda, type Filtros, type NotaBusca, type Ordem } from '../lib/busca'
import { brl, mesLabel, nf, PAY, payName } from '../lib/format'
import { NoteDrawer } from './NoteDrawer'
import { useToast } from './Toast'
import { Badge, Button, Card, Empty, Segmented, Select, cx } from './ui'

const POR_PAGINA = 50
const LIMITE = { xml: 20000, pdf: 500, csv: 100000 }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const campo = 'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none placeholder:text-subtle focus:border-accent'

// Período escolhido no seletor -> datas
function datas(p: string, de: string, ate: string): [string, string] {
  if (p.startsWith('m:')) return [p.slice(2) + '-01', p.slice(2) + '-31']
  const h = new Date(), menos = (n: number) => { const x = new Date(h); x.setDate(x.getDate() - n); return iso(x) }
  if (p === 'hoje') return [iso(h), iso(h)]
  if (p === '7') return [menos(6), iso(h)]
  if (p === '30') return [menos(29), iso(h)]
  if (p === 'custom') return [de, ate]
  return ['', '']
}

// Um campo só: número da nota, chave de acesso ou produto
function termo(t: string): Pick<Filtros, 'numero' | 'chave' | 'produto'> {
  const s = t.trim(), dig = s.replace(/\s/g, '')
  if (/^\d{1,9}$/.test(dig)) return { numero: dig, chave: '', produto: '' }
  if (/^\d{10,44}$/.test(dig)) return { numero: '', chave: dig, produto: '' }
  return { numero: '', chave: '', produto: s }
}

export function Busca({ lojas }: { lojas: Loja[] }) {
  const toast = useToast()
  const meses = useMemo(() => [...new Set(lojas.flatMap(l => l.meses.map(m => m.mes)))].sort().reverse(), [lojas])
  const [texto, setTexto] = useState('')
  const [loja, setLoja] = useState('')
  const [periodo, setPeriodo] = useState(meses[0] ? 'm:' + meses[0] : 'tudo')
  const [de, setDe] = useState(''), [ate, setAte] = useState('')
  const [extra, setExtra] = useState({ pagamento: '', canal: '' as Filtros['canal'], min: '', max: '', ordem: 'recentes' as Ordem })
  const [maisFiltros, setMaisFiltros] = useState(false)
  const [res, setRes] = useState<{ notas: NotaBusca[]; total: number; soma: number } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [sel, setSel] = useState<Map<string, NotaBusca>>(new Map())
  const [todos, setTodos] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [menu, setMenu] = useState(false)
  const [aberta, setAberta] = useState<NotaBusca | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const nome = useMemo(() => { const m = new Map(lojas.map(l => [l.cnpj, l.nome])); return (c: string) => m.get(c) || c }, [lojas])

  const filtros: Filtros = useMemo(() => {
    const [d, a] = datas(periodo, de, ate)
    return { ...filtrosVazios(), ...termo(texto), ...extra, cnpjs: loja ? [loja] : [], de: d, ate: a }
  }, [texto, loja, periodo, de, ate, extra])
  const chaveFiltros = JSON.stringify(filtros)

  const carregar = useCallback(async (f: Filtros, p: number) => {
    setCarregando(true); setErro('')
    try { setRes(await buscar(f, p, POR_PAGINA)); setPagina(p) }
    catch (e) { setErro((e as Error).message) }
    setCarregando(false)
  }, [])

  // busca automática (espera o usuário parar de digitar)
  useEffect(() => {
    const t = setTimeout(() => { setSel(new Map()); setTodos(false); carregar(filtros, 0) }, 350)
    return () => clearTimeout(t)
  }, [chaveFiltros])

  useEffect(() => {
    if (!menu) return
    const fora = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [menu])

  const notas = res?.notas || []
  const todasNaPagina = notas.length > 0 && notas.every(n => sel.has(n.chave))
  const qtdSel = todos ? res?.total || 0 : sel.size
  const extrasAtivos = [extra.pagamento, extra.canal, extra.min, extra.max, extra.ordem !== 'recentes' ? 1 : ''].filter(Boolean).length

  async function baixarLote(tipo: 'xml' | 'pdf' | 'csv' | 'csv-itens') {
    setMenu(false)
    if (!res?.total) return
    const t = tipo.startsWith('csv') ? 'csv' : tipo as 'xml' | 'pdf'
    const usar = qtdSel || res.total
    if (usar > LIMITE[t]) return toast(`O limite para ${t.toUpperCase()} é ${nf.format(LIMITE[t])} notas por vez. Escolha um período menor ou selecione menos notas.`, { tone: 'erro' })
    setBaixando(true)
    try {
      const prog = (m: string) => toast(m, { tone: 'carregando' })
      const lista = !todos && sel.size ? [...sel.values()] : await buscarTodas(filtros, usar, n => prog(`Lendo notas… ${nf.format(n)} de ${nf.format(usar)}`))
      if (t === 'csv') { baixarCsv(lista, tipo === 'csv-itens', nome); toast(`Planilha com ${nf.format(lista.length)} notas gerada.`, { tone: 'ok' }) }
      else {
        const r = t === 'xml' ? await baixarXmlsZip(lista, nome, prog) : await baixarPdfs(lista, prog)
        toast(<>{t === 'xml' ? 'ZIP' : 'PDF'} gerado com {nf.format(lista.length)} notas.{r.semXml > 0 && <span className="text-warn"> {nf.format(r.semXml)} sem XML no banco{t === 'pdf' ? ' (saíram como espelho)' : ' (listadas em notas-sem-xml.txt)'}.</span>}</>, { tone: 'ok', fixo: r.semXml > 0 })
      }
    } catch (e) { toast('Erro no download: ' + (e as Error).message, { tone: 'erro' }) }
    setBaixando(false)
  }

  const paginas = Math.max(1, Math.ceil((res?.total || 0) / POR_PAGINA))
  const dt = (n: NotaBusca) => `${n.dh.slice(8, 10)}/${n.dh.slice(5, 7)}/${n.dh.slice(0, 4)} ${n.dh.slice(11, 16)}`
  const drawer = aberta ? paraNota(aberta) : null
  const opcoes: [string, string, typeof FileCode2][] = [['xml', 'XMLs (.zip)', FileCode2], ['pdf', 'PDF das notas', FileDown], ['csv', 'Planilha (uma linha por nota)', FileSpreadsheet], ['csv-itens', 'Planilha (uma linha por item)', FileSpreadsheet]]

  return (
    <div className="anim-entrar flex flex-col gap-4">
      {/* barra de busca */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Nº da nota, chave de acesso ou produto" className={campo + ' h-11 pl-10 text-[15px]'} />
          {texto && <button aria-label="Limpar" onClick={() => setTexto('')} className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-lg p-1.5 text-muted hover:text-fg"><X className="size-4" /></button>}
        </label>
        <Select value={loja} onChange={e => setLoja(e.target.value)} className="w-full sm:w-60" aria-label="Loja">
          <option value="">Todas as lojas</option>
          {lojas.map(l => <option key={l.cnpj} value={l.cnpj}>{l.nome}</option>)}
        </Select>
        <Select value={periodo} onChange={e => setPeriodo(e.target.value)} className="w-full sm:w-52" aria-label="Período">
          {meses.map(m => <option key={m} value={'m:' + m}>{mesLabel(m)}</option>)}
          <option value="hoje">Hoje</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="custom">Escolher datas…</option>
          <option value="tudo">Todo o período</option>
        </Select>
        <Button onClick={() => setMaisFiltros(!maisFiltros)} variant={maisFiltros || extrasAtivos ? 'primary' : 'secondary'} className="h-10">
          <SlidersHorizontal className="size-4" />Filtros{extrasAtivos > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{extrasAtivos}</span>}
        </Button>
      </div>

      {periodo === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          De <input type="date" className={campo.replace('w-full', 'w-40')} value={de} max={ate || undefined} onChange={e => setDe(e.target.value)} />
          até <input type="date" className={campo.replace('w-full', 'w-40')} value={ate} min={de || undefined} onChange={e => setAte(e.target.value)} />
        </div>
      )}

      {maisFiltros && (
        <Card className="anim-entrar grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Forma de pagamento
            <Select value={extra.pagamento} onChange={e => setExtra({ ...extra, pagamento: e.target.value })}>
              <option value="">Todas</option>
              {Object.entries(PAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
          <div className="flex flex-col gap-1.5 text-xs font-medium text-muted">Canal
            <Segmented value={extra.canal} onChange={v => setExtra({ ...extra, canal: v })} options={[['', 'Todos'], ['salao', 'Salão'], ['entrega', 'Entrega']]} />
          </div>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Valor da nota (R$)
            <div className="flex items-center gap-2">
              <input className={campo} inputMode="decimal" value={extra.min} onChange={e => setExtra({ ...extra, min: e.target.value })} placeholder="de" />
              <input className={campo} inputMode="decimal" value={extra.max} onChange={e => setExtra({ ...extra, max: e.target.value })} placeholder="até" />
            </div>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">Ordenar por
            <Select value={extra.ordem} onChange={e => setExtra({ ...extra, ordem: e.target.value as Ordem })}>
              <option value="recentes">Mais recentes</option><option value="antigas">Mais antigas</option>
              <option value="maior_valor">Maior valor</option><option value="menor_valor">Menor valor</option>
            </Select>
          </label>
          {extrasAtivos > 0 && <button onClick={() => setExtra({ pagamento: '', canal: '', min: '', max: '', ordem: 'recentes' })} className="cursor-pointer text-left text-xs font-medium text-accent hover:underline sm:col-span-2 lg:col-span-4">Limpar filtros</button>}
        </Card>
      )}

      {erro ? <Card><Empty icon={<CircleAlert className="size-6" />} title="Não foi possível buscar">{erro}</Empty></Card> : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
                {res ? <>{nf.format(res.total)} {res.total === 1 ? "nota" : "notas"} {res.total > 0 && <span className="font-normal text-muted">· {brl.format(res.soma)}</span>}</> : 'Buscando…'}
                {carregando && <LoaderCircle className="size-4 animate-spin text-muted" />}
              </h2>
              {qtdSel > 0 && <p className="text-xs text-muted">{nf.format(qtdSel)} selecionada{qtdSel > 1 ? 's' : ''} · <button className="cursor-pointer text-accent hover:underline" onClick={() => { setSel(new Map()); setTodos(false) }}>limpar</button>
                {!todos && todasNaPagina && res && res.total > notas.length && <> · <button className="cursor-pointer font-medium text-accent hover:underline" onClick={() => setTodos(true)}>selecionar todas as {nf.format(res.total)}</button></>}</p>}
            </div>
            <div className="relative" ref={menuRef}>
              <Button variant="primary" onClick={() => setMenu(!menu)} disabled={baixando || !res?.total}>
                {baixando ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                Baixar {qtdSel ? `${nf.format(qtdSel)} selecionada${qtdSel > 1 ? 's' : ''}` : 'tudo'}<ChevronDown className="size-4" />
              </Button>
              {menu && (
                <div className="anim-fade absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl">
                  {opcoes.map(([k, l, I]) => (
                    <button key={k} onClick={() => baixarLote(k as 'xml')} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-2">
                      <I className="size-4 text-muted" />{l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="w-10 px-5 py-2.5"><input type="checkbox" aria-label="Selecionar página" checked={todos || todasNaPagina} onChange={e => { setTodos(false); setSel(s => { const m = new Map(s); notas.forEach(x => e.target.checked ? m.set(x.chave, x) : m.delete(x.chave)); return m }) }} className="accent-[var(--accent)]" /></th>
                  {!loja && <th className="px-3 py-2.5">Loja</th>}
                  <th className="px-3 py-2.5">Nº</th><th className="px-3 py-2.5">Emissão</th><th className="px-3 py-2.5">Canal</th>
                  <th className="px-3 py-2.5">Pagamento</th><th className="px-5 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className={cx('transition-opacity', carregando && 'opacity-50')}>
                {notas.map(n => {
                  const v = venda(n.info)
                  return (
                    <tr key={n.chave} onClick={() => setAberta(n)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2">
                      <td className="px-5 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Selecionar nota ${n.n}`} checked={todos || sel.has(n.chave)} className="accent-[var(--accent)]"
                          onChange={e => { setTodos(false); setSel(s => { const m = new Map(todos ? notas.map(y => [y.chave, y] as const) : s); e.target.checked ? m.set(n.chave, n) : m.delete(n.chave); return m }) }} />
                      </td>
                      {!loja && <td className="max-w-48 truncate px-3 py-3">{nome(n.cnpj)}</td>}
                      <td className="px-3 py-3 font-mono text-xs">{n.n}</td>
                      <td className="px-3 py-3 font-mono text-xs text-muted">{dt(n)}</td>
                      <td className="px-3 py-3"><Badge tone={v.canal === 'entrega' ? 'ok' : 'accent'}>{v.canal === 'entrega' ? 'Entrega' : 'Salão'}</Badge> <span className="text-xs text-muted">{v.ref}</span></td>
                      <td className="max-w-56 truncate px-3 py-3">{n.pagamentos.map(p => payName(p[0])).join(' + ')}</td>
                      <td className="num px-5 py-3 text-right font-semibold">{brl.format(+n.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {res && !notas.length && <p className="py-14 text-center text-sm text-muted">Nenhuma nota encontrada. Tente outro período ou loja.</p>}
          </div>
          {paginas > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
              <span>Página {pagina + 1} de {nf.format(paginas)}</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={pagina === 0 || carregando} onClick={() => carregar(filtros, pagina - 1)}><ChevronLeft className="size-4" />Anterior</Button>
                <Button size="sm" disabled={pagina >= paginas - 1 || carregando} onClick={() => carregar(filtros, pagina + 1)}>Próxima<ChevronRight className="size-4" /></Button>
              </div>
            </div>
          )}
        </Card>
      )}
      {drawer && <NoteDrawer note={drawer.note} mes={drawer.mes} onClose={() => setAberta(null)} />}
    </div>
  )
}
