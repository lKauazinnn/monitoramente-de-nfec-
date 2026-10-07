import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, CloudUpload, Database, DatabaseZap, FileUp, LoaderCircle, LogOut, Moon, ShieldCheck, Sun, Upload, UserRound } from 'lucide-react'
import { carregarIndice, geradoEm, montarLojas, type Loja, type Pendente } from './lib/data'
import { protegerArmazenamento } from './lib/db'
import { cidade, fmtCnpj, mesLabel, nf } from './lib/format'
import { enviarPublicados, importar } from './lib/importer'
import { baixar } from './lib/pdf'
import { apiAdmin, linkInicial, remoto, sb } from './lib/remote'
import { Admin } from './components/Admin'
import { PaletaCtx, paleta } from './components/charts'
import { Overview } from './components/Overview'
import { SessaoCtx, TelaLogin, TelaNovaSenha } from './components/Sessao'
import { StoreView } from './components/StoreView'
import { useToast } from './components/Toast'
import { Button, Card, Empty, Select, Skeleton } from './components/ui'

interface Vista { loja: string; mes: string }

export default function App() {
  const toast = useToast()
  const [lojas, setLojas] = useState<Loja[] | null>(null)
  const [importadas, setImportadas] = useState(0)
  const [protegido, setProtegido] = useState(false)
  const [v, setV] = useState<Vista>({ loja: 'todas', mes: '' })
  const [versao, setVersao] = useState(0)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [arrastando, setArrastando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [pendentes, setPendentes] = useState<Pendente[]>([])
  const [sessao, setSessao] = useState<Session | null | undefined>(remoto ? undefined : null)
  const [definirSenha, setDefinirSenha] = useState(remoto && ['recovery', 'invite'].includes(linkInicial.tipo))
  const [admin, setAdmin] = useState(false)
  const [tela, setTela] = useState<'painel' | 'admin'>('painel')
  const email = sessao?.user.email ?? null
  const uid = sessao?.user.id
  const arq = useRef<HTMLInputElement>(null)

  const atualizar = useCallback(async () => {
    try {
      const r = await montarLojas()
      setLojas(r.lojas); setImportadas(r.importadas); setPendentes(r.pendentes)
      return r.lojas
    } catch (e) {
      toast('Não foi possível ler o banco central: ' + (e as Error).message, { tone: 'erro', fixo: true })
      setLojas([])
      return []
    }
  }, [toast])

  useEffect(() => {
    if (!sb) return
    sb.auth.getSession().then(({ data }) => setSessao(data.session))
    const { data } = sb.auth.onAuthStateChange((ev, s) => { setSessao(s); if (ev === 'PASSWORD_RECOVERY') setDefinirSenha(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  const escolherArquivos = () => arq.current?.click()

  async function sincronizar() {
    setImportando(true)
    try {
      const n = await enviarPublicados(pendentes, m => toast(m, { tone: 'carregando' }))
      const ls = await atualizar(); setVersao(x => x + 1)
      if (ls.length === 1 && v.loja === 'todas') abrirLoja(ls[0].cnpj, undefined, ls)
      toast(<><b>Dados publicados enviados ao banco</b>: {nf.format(n)} notas conferidas (as que já estavam lá foram mantidas).</>, { tone: 'ok' })
    } catch (e) { toast('Erro ao enviar: ' + (e as Error).message, { tone: 'erro', fixo: true }) }
    setImportando(false)
  }

  const abrirLoja = useCallback((cnpj: string, mes?: string, ls?: Loja[]) => {
    const L = (ls || lojas || []).find(l => l.cnpj === cnpj)
    if (!L) return setV({ loja: 'todas', mes: '' })
    const meses = L.meses.map(m => m.mes)
    setV({ loja: cnpj, mes: mes && meses.includes(mes) ? mes : meses[meses.length - 1] })
  }, [lojas])

  // Com banco central, nada é carregado antes do login
  useEffect(() => {
    if (remoto && !uid) { setLojas(null); setAdmin(false); setTela('painel'); return }
    carregarIndice().then(atualizar).then(ls => { if (ls.length === 1) abrirLoja(ls[0].cnpj, undefined, ls) })
    protegerArmazenamento().then(setProtegido)
    if (remoto) apiAdmin<{ admin: boolean }>({ acao: 'eu' }).then(r => setAdmin(r.admin), () => setAdmin(false))
  }, [uid])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('tema', dark ? 'dark' : 'light') } catch { /* sem localStorage */ }
  }, [dark])

  const onImport = useCallback(async (files: File[]) => {
    if (importando || !files.length) return
    setImportando(true)
    try {
      const r = await importar(files, msg => toast(msg, { tone: 'carregando' }))
      const ls = await atualizar()
      setProtegido(await protegerArmazenamento())
      setVersao(x => x + 1)
      const log = r.erros.join('\r\n')
      toast(<><b>Importação concluída</b> em {r.segundos}s: {nf.format(r.ok)} notas em {r.meses.length} loja/mês.
        {r.erros.length > 0 && <span className="text-danger"> {nf.format(r.erros.length)} com erro.</span>}</>,
        { tone: r.erros.length ? 'erro' : 'ok', fixo: r.erros.length > 0, acao: r.erros.length ? { label: 'Baixar log de erros', onClick: () => baixar(`importacao-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}.log`, log, 'text/plain') } : undefined })
      const cnpjs = [...new Set(r.meses.map(m => m.cnpj))]
      if (cnpjs.length === 1) abrirLoja(cnpjs[0], r.meses.map(m => m.mes).sort().pop(), ls)
    } catch (e) {
      toast('Erro na importação: ' + (e as Error).message, { tone: 'erro' })
    }
    setImportando(false)
  }, [importando, atualizar, abrirLoja, toast])

  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setArrastando(true) } }
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setArrastando(false) }
    const drop = (e: DragEvent) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); setArrastando(false); onImport([...e.dataTransfer.files]) }
    document.addEventListener('dragover', over); document.addEventListener('dragleave', leave); document.addEventListener('drop', drop)
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('dragleave', leave); document.removeEventListener('drop', drop) }
  }, [onImport])

  if (remoto && sessao === undefined) return <div className="grid min-h-screen place-items-center"><LoaderCircle className="size-6 animate-spin text-accent" /></div>
  if (remoto && !sessao) return <TelaLogin erroLink={linkInicial.erro} />
  if (remoto && definirSenha) return (
    <TelaNovaSenha convite={linkInicial.tipo === 'invite'} onPronto={() => {
      setDefinirSenha(false); history.replaceState(null, '', location.pathname); toast('Senha salva. Bem-vindo!', { tone: 'ok' })
    }} />
  )

  const L = tela === 'admin' ? undefined : lojas?.find(l => l.cnpj === v.loja)
  const mesesTodos = [...new Set((lojas || []).flatMap(l => l.meses.map(m => m.mes)))].sort()
  const gerado = geradoEm()

  return (
    <SessaoCtx.Provider value={{ remoto, email, pedirLogin: () => {} }}>
    <PaletaCtx.Provider value={paleta(dark)}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <button onClick={() => setV({ loja: 'todas', mes: '' })} className="mr-auto flex cursor-pointer items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">N</span>
              <span className="flex flex-col items-start leading-tight">
                <span className="text-sm font-semibold tracking-tight">Painel NFC-e</span>
                <span className="text-[11px] text-muted">CAJUPAR</span>
              </span>
            </button>
            {tela === 'painel' && lojas && lojas.length > 0 && <div className="order-last flex w-full gap-2 lg:order-none lg:w-auto">
              <Select className="min-w-0 flex-1 lg:w-64 lg:flex-none" value={v.loja} onChange={e => e.target.value === 'todas' ? setV({ loja: 'todas', mes: '' }) : abrirLoja(e.target.value, v.mes)} aria-label="Loja">
                <option value="todas">Todas as lojas ({lojas.length})</option>
                {lojas.map(l => <option key={l.cnpj} value={l.cnpj}>{l.nome} · {cidade(l.end)}</option>)}
              </Select>
              <Select className="min-w-0 flex-1 lg:w-52 lg:flex-none" value={v.mes} aria-label="Mês"
                onChange={e => v.loja === 'todas' ? setV({ ...v, mes: e.target.value }) : abrirLoja(v.loja, e.target.value)}>
                {L ? L.meses.map(m => <option key={m.mes} value={m.mes}>{mesLabel(m.mes)} · {nf.format(m.notas)} notas</option>)
                  : <><option value="">Todos os meses</option>{mesesTodos.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}</>}
              </Select>
            </div>}
            {admin && (
              <Button variant={tela === 'admin' ? 'primary' : 'secondary'} onClick={() => setTela(tela === 'admin' ? 'painel' : 'admin')}>
                {tela === 'admin' ? <><ArrowLeft className="size-4" />Painel</> : <><ShieldCheck className="size-4" />Admin</>}
              </Button>
            )}
            {remoto && email && (
              <div className="flex h-10 items-center gap-1 rounded-xl border border-line bg-surface pr-1 pl-3 text-xs text-muted" title={email}>
                <UserRound className="size-3.5" /><span className="max-w-40 truncate max-sm:hidden">{email}</span>
                <Button variant="ghost" size="sm" aria-label="Sair" title="Sair" onClick={() => sb!.auth.signOut()}><LogOut className="size-3.5" /></Button>
              </div>
            )}
            {tela === 'painel' && <Button variant="primary" onClick={escolherArquivos} disabled={importando} title="Arquivos .csv salvos do SSMS com a consulta CONSULTA-SSMS.sql (ou XMLs de NFC-e). Também dá para arrastar para a página.">
              <Upload className="size-4" /><span className="max-sm:hidden">Importar CSV</span><span className="sm:hidden">Importar</span>
            </Button>}
            <Button variant="ghost" aria-label={dark ? 'Tema claro' : 'Tema escuro'} size="icon" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <input ref={arq} type="file" multiple accept=".csv,.txt,.xml" hidden onChange={e => { const f = [...(e.target.files || [])]; e.target.value = ''; onImport(f) }} />
          </div>
        </header>

        <main className="mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          {tela === 'admin' && uid ? (<>
            <div>
              <p className="font-mono text-[11px] tracking-wider text-muted uppercase">Administração</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Usuários e acessos</h1>
            </div>
            <Admin meuId={uid} lojas={lojas || []} onLojas={atualizar} />
          </>) : <>
          {lojas && lojas.length > 0 && (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] tracking-wider text-muted uppercase">
                  {L ? `${L.loja} · CNPJ ${fmtCnpj(L.cnpj)} · ${L.end}` : 'Visão geral da rede'}
                </p>
                <h1 className="mt-1 truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                  {L ? L.nome : 'Todas as lojas'} {L && <span className="text-accent">{mesLabel(v.mes)}</span>}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {remoto ? (
                  <span className="inline-flex items-center gap-1.5" title="Notas guardadas no banco central: todos que abrem o painel veem os mesmos dados. Nenhuma nota pode ser apagada ou alterada.">
                    <Database className="size-3.5 text-ok" />Banco central · {nf.format(importadas)} notas · protegido contra exclusão
                  </span>
                ) : importadas > 0 && (
                  <span className="inline-flex items-center gap-1.5" title={protegido ? 'O navegador foi instruído a não apagar estes dados automaticamente' : 'O navegador pode liberar espaço apagando dados de sites; mantenha os CSVs originais guardados'}>
                    {protegido ? <ShieldCheck className="size-3.5 text-ok" /> : <DatabaseZap className="size-3.5 text-warn" />}
                    {nf.format(importadas)} notas importadas neste navegador{protegido ? ' · armazenamento protegido' : ''}
                  </span>
                )}
                {gerado && !remoto && <span>Dados publicados em {new Date(gerado).toLocaleString('pt-BR')}</span>}
              </div>
            </div>
          )}

          {remoto && email && pendentes.length > 0 && (
            <Card className="flex flex-wrap items-center gap-4 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-warn-soft text-warn"><CloudUpload className="size-5" /></span>
              <div className="min-w-0 flex-1 text-sm">
                <b>{pendentes.length} {pendentes.length === 1 ? 'mês publicado ainda não está' : 'meses publicados ainda não estão'} completos no banco central</b>
                <p className="text-muted">{pendentes.map(p => `${p.loja} ${mesLabel(p.mes)}`).join(' · ')}. Envie para que todos vejam esses dados.</p>
              </div>
              <Button variant="primary" onClick={sincronizar} disabled={importando}><CloudUpload className="size-4" />Enviar para o banco</Button>
            </Card>
          )}

          {!lojas ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}</div>
          ) : !lojas.length ? (
            <Empty icon={<FileUp className="size-6" />} title="Nenhum dado ainda">
              Clique em <b>Importar CSV</b> ou arraste para esta página os arquivos .csv salvos do SSMS com a consulta <span className="font-mono">CONSULTA-SSMS.sql</span>.
            </Empty>
          ) : L ? (
            <StoreView key={`${L.cnpj}|${v.mes}|${versao}`} loja={L} mes={v.mes} />
          ) : (
            <Overview lojas={lojas} mes={v.mes} setMes={m => setV({ ...v, mes: m })} abrirLoja={c => abrirLoja(c, v.mes)} />
          )}
          </>}
        </main>

        {arrastando && (
          <div className="anim-fade pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent bg-surface px-16 py-12 text-center shadow-2xl">
              <Upload className="size-8 text-accent" />
              <p className="text-lg font-semibold">Solte os CSVs do SSMS para importar</p>
              <p className="text-sm text-muted">As notas são somadas às que já existem. Nada é apagado.</p>
            </div>
          </div>
        )}
      </div>
    </PaletaCtx.Provider>
    </SessaoCtx.Provider>
  )
}
