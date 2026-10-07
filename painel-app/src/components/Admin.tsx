import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Ban, Check, CircleAlert, KeyRound, LoaderCircle, MailPlus, RefreshCw, RotateCcw, Search, Shield, ShieldOff, Store, UserPlus, Users, UserCheck, X } from 'lucide-react'
import type { Loja } from '../lib/data'
import { apiAdmin } from '../lib/remote'
import { fmtCnpj, nf, nomeAuto } from '../lib/format'
import { useToast } from './Toast'
import { Badge, Button, Card, Empty, Kpi, Segmented, Select, Skeleton, cx } from './ui'

interface Usuario {
  id: string; email: string; nome: string; papel: 'admin' | 'usuario'; adminFixo: boolean; criado: string; ultimoAcesso: string | null
  confirmado: boolean; convitePendente: boolean; desativado: boolean; notasImportadas: number; ultimaImportacao: string | null
}

const quando = (s: string | null) => {
  if (!s) return '—'
  const d = (Date.now() - new Date(s).getTime()) / 1000
  if (d < 60) return 'agora'
  if (d < 3600) return `há ${Math.floor(d / 60)} min`
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`
  if (d < 86400 * 30) return `há ${Math.floor(d / 86400)} d`
  return new Date(s).toLocaleDateString('pt-BR')
}
const iniciais = (u: Usuario) => (u.nome || u.email).split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase()).join('')

function status(u: Usuario): [string, 'ok' | 'warn' | 'neutral' | 'accent'] {
  if (u.desativado) return ['Desativado', 'neutral']
  if (u.convitePendente) return ['Convite pendente', 'warn']
  if (!u.confirmado) return ['E-mail não confirmado', 'warn']
  return ['Ativo', 'ok']
}

export function Admin({ meuId, lojas, onLojas }: { meuId: string; lojas: Loja[]; onLojas: () => Promise<unknown> }) {
  const toast = useToast()
  const [lista, setLista] = useState<Usuario[] | null>(null)
  const [erro, setErro] = useState('')
  const [q, setQ] = useState('')
  const [novo, setNovo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setErro('')
    try { setLista((await apiAdmin<{ usuarios: Usuario[] }>({ acao: 'listar' })).usuarios) }
    catch (e) { setErro((e as Error).message) }
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function agir(u: Usuario, acao: string, extra: Record<string, unknown> = {}, pergunta?: string, ok?: string) {
    if (pergunta && !confirm(pergunta)) return
    setOcupado(u.id + acao)
    try { await apiAdmin({ acao, id: u.id, ...extra }); toast(ok || 'Feito.', { tone: 'ok' }); await carregar() }
    catch (e) { toast((e as Error).message, { tone: 'erro' }) }
    setOcupado(null)
  }

  const filtrada = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (lista || []).filter(u => !t || u.email.toLowerCase().includes(t) || u.nome.toLowerCase().includes(t))
      .sort((a, b) => Number(a.desativado) - Number(b.desativado) || (b.ultimoAcesso || '').localeCompare(a.ultimoAcesso || ''))
  }, [lista, q])

  if (erro) return (
    <Card><Empty icon={<CircleAlert className="size-6" />} title="Não foi possível abrir a administração">
      {erro}
      {/SUPABASE_SECRET_KEY|SUPABASE_URL/.test(erro) && <p className="mt-2">Em Vercel → Settings → Environment Variables, cadastre <b>SUPABASE_URL</b> e <b>SUPABASE_SECRET_KEY</b> e publique de novo.</p>}
      <Button className="mt-4" onClick={carregar}><RefreshCw className="size-4" />Tentar de novo</Button>
    </Empty></Card>
  )
  if (!lista) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px]" />)}<Skeleton className="h-96 sm:col-span-2 xl:col-span-4" /></div>

  const mes = Date.now() - 30 * 86400e3
  return (
    <div className="anim-entrar flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Usuários" value={nf.format(lista.length)} sub="cadastrados" icon={<Users className="size-4" />} tone="accent" />
        <Kpi label="Ativos em 30 dias" value={nf.format(lista.filter(u => u.ultimoAcesso && new Date(u.ultimoAcesso).getTime() > mes).length)} sub="entraram no último mês" icon={<UserCheck className="size-4" />} />
        <Kpi label="Administradores" value={nf.format(lista.filter(u => u.papel === 'admin' && !u.desativado).length)} sub="gerenciam usuários" icon={<Shield className="size-4" />} />
        <Kpi label="Desativados" value={nf.format(lista.filter(u => u.desativado).length)} sub="sem acesso ao painel" icon={<Ban className="size-4" />} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">Usuários</h2>
            <p className="text-xs text-muted">Desativar bloqueia o acesso sem apagar nada. As notas importadas continuam no banco.</p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <label className="relative flex-1 sm:w-64 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar nome ou e-mail" className="h-10 w-full rounded-xl border border-line bg-surface-2 pr-3 pl-9 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface" />
            </label>
            <Button size="icon" variant="ghost" aria-label="Atualizar" onClick={carregar}><RefreshCw className="size-4" /></Button>
            <Button variant="primary" onClick={() => setNovo(true)}><UserPlus className="size-4" /><span className="max-sm:hidden">Novo usuário</span></Button>
          </div>
        </div>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-2 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                <th className="px-5 py-2.5">Usuário</th><th className="px-3 py-2.5">Papel</th><th className="px-3 py-2.5">Situação</th>
                <th className="px-3 py-2.5">Último acesso</th><th className="px-3 py-2.5 text-right">Notas importadas</th><th className="px-3 py-2.5">Cadastro</th><th className="px-5 py-2.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map(u => {
                const [st, tom] = status(u), eu = u.id === meuId
                return (
                  <tr key={u.id} className={cx('border-b border-line last:border-0', u.desativado && 'opacity-60')}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={cx('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold', u.papel === 'admin' ? 'bg-accent text-white' : 'bg-surface-3 text-muted')}>{iniciais(u)}</span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{u.nome || u.email.split('@')[0]} {eu && <span className="text-xs font-normal text-muted">(você)</span>}</div>
                          <div className="truncate text-xs text-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><Badge tone={u.papel === 'admin' ? 'accent' : 'neutral'}>{u.papel === 'admin' ? 'Admin' : 'Usuário'}</Badge></td>
                    <td className="px-3 py-3"><Badge tone={tom}>{st}</Badge></td>
                    <td className="px-3 py-3 text-muted" title={u.ultimoAcesso ? new Date(u.ultimoAcesso).toLocaleString('pt-BR') : ''}>{quando(u.ultimoAcesso)}</td>
                    <td className="num px-3 py-3 text-right" title={u.ultimaImportacao ? 'Última: ' + new Date(u.ultimaImportacao).toLocaleString('pt-BR') : ''}>{nf.format(u.notasImportadas)}</td>
                    <td className="px-3 py-3 text-muted">{new Date(u.criado).toLocaleDateString('pt-BR')}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        {ocupado?.startsWith(u.id) ? <LoaderCircle className="m-2 size-4 animate-spin text-muted" /> : <>
                          <Button size="icon" variant="ghost" disabled={eu || u.adminFixo} title={u.adminFixo ? 'Administrador fixo (ADMIN_EMAILS)' : u.papel === 'admin' ? 'Tornar usuário comum' : 'Tornar administrador'}
                            onClick={() => agir(u, 'papel', { papel: u.papel === 'admin' ? 'usuario' : 'admin' }, `${u.papel === 'admin' ? 'Remover o acesso de admin de' : 'Tornar administrador'} ${u.email}?`, 'Papel atualizado.')}>
                            {u.papel === 'admin' ? <ShieldOff className="size-4" /> : <Shield className="size-4" />}
                          </Button>
                          <Button size="icon" variant="ghost" disabled={u.desativado} title="Enviar e-mail para redefinir a senha"
                            onClick={() => agir(u, 'redefinir', {}, `Enviar para ${u.email} um link de redefinição de senha?`, 'E-mail de redefinição enviado.')}><KeyRound className="size-4" /></Button>
                          {u.desativado
                            ? <Button size="icon" variant="ghost" title="Reativar acesso" onClick={() => agir(u, 'reativar', {}, `Reativar o acesso de ${u.email}?`, 'Acesso reativado.')}><RotateCcw className="size-4" /></Button>
                            : <Button size="icon" variant="ghost" disabled={eu || u.adminFixo} title={eu ? 'Você não pode desativar a si mesmo' : 'Desativar acesso'} className="hover:text-danger"
                                onClick={() => agir(u, 'desativar', {}, `Desativar o acesso de ${u.email}? Ele não conseguirá mais entrar (pode ser reativado depois).`, 'Acesso desativado.')}><Ban className="size-4" /></Button>}
                        </>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!filtrada.length && <p className="py-12 text-center text-sm text-muted">Nenhum usuário encontrado.</p>}
        </div>
      </Card>
      <LojasCard lojas={lojas} onLojas={onLojas} />
      {novo && <NovoUsuario onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar() }} />}
    </div>
  )
}

function NovoUsuario({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const toast = useToast()
  const [modo, setModo] = useState<'convidar' | 'criar'>('criar')
  const [f, setF] = useState({ nome: '', email: '', papel: 'usuario', senha: '' })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const campo = 'h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface'

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true); setErro('')
    try {
      await apiAdmin({ acao: modo, ...f })
      toast(modo === 'convidar' ? `Convite enviado para ${f.email}.` : `Usuário ${f.email} criado. Passe a senha para ele por um canal seguro.`, { tone: 'ok' })
      onCriado()
    } catch (e) { setErro((e as Error).message) }
    setEnviando(false)
  }

  return createPortal(
    <>
      <div className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={salvar} role="dialog" aria-label="Novo usuário"
        className="anim-entrar fixed top-1/2 left-1/2 z-50 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border border-line bg-surface p-7 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Novo usuário</h2>
            <p className="mt-1 text-sm text-muted">Só quem você cadastrar consegue entrar no painel.</p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-5" /></button>
        </div>
        <Segmented value={modo} onChange={setModo} options={[['criar', 'Definir senha agora'], ['convidar', 'Convidar por e-mail']]} />
        <label className="flex flex-col gap-1.5 text-sm font-medium">Nome
          <input className={campo} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder="Nome e sobrenome" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">E-mail
          <input className={campo} type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="nome@cajupar.com" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">Papel
          <Select value={f.papel} onChange={e => setF({ ...f, papel: e.target.value })}>
            <option value="usuario">Usuário: vê o painel, importa notas, baixa XML e PDF</option>
            <option value="admin">Admin: tudo isso e também gerencia usuários</option>
          </Select>
        </label>
        {modo === 'criar' && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">Senha inicial
            <input className={campo} type="text" required minLength={8} value={f.senha} onChange={e => setF({ ...f, senha: e.target.value })} placeholder="mínimo 8 caracteres" autoComplete="off" />
          </label>
        )}
        <p className="text-xs text-muted">{modo === 'convidar'
          ? 'A pessoa recebe um e-mail com um link para criar a própria senha (precisa do SMTP configurado no Supabase).'
          : 'O usuário já fica ativo com esta senha. Ele pode trocá-la depois em "Esqueci minha senha".'}</p>
        {erro && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-danger">{erro}</p>}
        <Button variant="primary" type="submit" disabled={enviando} className="h-11">
          {enviando ? <LoaderCircle className="size-4 animate-spin" /> : modo === 'convidar' ? <MailPlus className="size-4" /> : <UserPlus className="size-4" />}
          {modo === 'convidar' ? 'Enviar convite' : 'Criar usuário'}
        </Button>
      </form>
    </>,
    document.body,
  )
}

function LojasCard({ lojas, onLojas }: { lojas: Loja[]; onLojas: () => Promise<unknown> }) {
  const toast = useToast()
  const [ed, setEd] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)

  async function salvar(l: Loja) {
    setSalvando(l.cnpj)
    try {
      await apiAdmin({ acao: 'apelido', cnpj: l.cnpj, apelido: ed[l.cnpj] ?? l.apelido })
      await onLojas()
      setEd(e => { const n = { ...e }; delete n[l.cnpj]; return n })
      toast('Nome da loja atualizado.', { tone: 'ok' })
    } catch (e) { toast((e as Error).message, { tone: 'erro' }) }
    setSalvando(null)
  }

  return (
    <Card>
      <div className="px-5 pt-5 pb-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Store className="size-4 text-muted" />Lojas</h2>
        <p className="text-xs text-muted">Nome que aparece no painel para cada unidade. Em branco, usa a marca + o bairro do endereço da nota.</p>
      </div>
      <ul className="border-t border-line">
        {lojas.map(l => {
          const valor = ed[l.cnpj] ?? l.apelido, mudou = valor.trim() !== l.apelido
          return (
            <li key={l.cnpj} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <div className="min-w-0 flex-1 basis-64">
                <div className="truncate text-sm font-medium">{l.loja} <span className="font-mono text-xs font-normal text-subtle">{fmtCnpj(l.cnpj)}</span></div>
                <div className="truncate text-xs text-muted">{l.end}</div>
              </div>
              <form className="flex w-full gap-2 sm:w-auto" onSubmit={e => { e.preventDefault(); if (mudou) salvar(l) }}>
                <input value={valor} maxLength={60} onChange={e => setEd({ ...ed, [l.cnpj]: e.target.value })} placeholder={nomeAuto(l.loja, l.end)}
                  aria-label={`Nome de exibição de ${l.loja}`}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface sm:w-64" />
                <Button type="submit" variant={mudou ? 'primary' : 'secondary'} disabled={!mudou || salvando === l.cnpj}>
                  {salvando === l.cnpj ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Salvar
                </Button>
              </form>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
