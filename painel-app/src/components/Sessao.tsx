import { createContext, useState, type FormEvent } from 'react'
import { LoaderCircle, LockKeyhole, X } from 'lucide-react'
import { sb } from '../lib/remote'
import { Button } from './ui'

export interface Sessao { remoto: boolean; email: string | null; pedirLogin: () => void }
export const SessaoCtx = createContext<Sessao>({ remoto: false, email: null, pedirLogin: () => {} })

const traduzir = (m: string) =>
  /invalid login credentials/i.test(m) ? 'E-mail ou senha incorretos.'
    : /email not confirmed/i.test(m) ? 'E-mail ainda não confirmado. Peça ao administrador para confirmar o usuário.'
      : /fetch|network/i.test(m) ? 'Sem conexão com o banco. Verifique a internet.'
        : m

export function LoginModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!sb) return
    setEnviando(true); setErro('')
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) setErro(traduzir(error.message)); else onClose()
  }

  const campo = 'h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-sm outline-none placeholder:text-subtle focus:border-accent focus:bg-surface'
  return (
    <>
      <div className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={entrar} role="dialog" aria-label="Entrar"
        className="anim-entrar fixed top-1/2 left-1/2 z-50 flex w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-3xl border border-line bg-surface p-7 shadow-2xl">
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent"><LockKeyhole className="size-5" /></span>
          <button type="button" aria-label="Fechar" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-5" /></button>
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Entrar no painel</h2>
          <p className="mt-1 text-sm text-muted">O login é necessário para importar notas e baixar XMLs. Os usuários são criados pelo administrador.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">E-mail
          <input className={campo} type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@cajupar.com" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">Senha
          <input className={campo} type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
        </label>
        {erro && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-danger">{erro}</p>}
        <Button variant="primary" type="submit" disabled={enviando} className="h-11">
          {enviando && <LoaderCircle className="size-4 animate-spin" />}Entrar
        </Button>
      </form>
    </>
  )
}
