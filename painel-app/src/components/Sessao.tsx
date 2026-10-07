import { createContext, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, BarChart3, CircleAlert, Eye, EyeOff, FileDown, KeyRound, LoaderCircle, MailCheck, ShieldCheck } from 'lucide-react'
import { sb, urlRetorno } from '../lib/remote'
import { Button } from './ui'

export interface Sessao { remoto: boolean; email: string | null; pedirLogin: () => void }
export const SessaoCtx = createContext<Sessao>({ remoto: false, email: null, pedirLogin: () => {} })

export const traduzir = (m: string) =>
  /invalid login credentials/i.test(m) ? 'E-mail ou senha incorretos.'
    : /email not confirmed/i.test(m) ? 'Seu e-mail ainda não foi confirmado. Abra o link enviado para o seu e-mail ou fale com o administrador.'
      : /banned|user is banned/i.test(m) ? 'Este usuário está desativado. Fale com o administrador.'
        : /rate limit|too many/i.test(m) ? 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'
          : /same.*password|different from the old/i.test(m) ? 'A nova senha precisa ser diferente da atual.'
            : /password.*(short|least|characters)|weak/i.test(m) ? 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.'
              : /expired|invalid.*(link|token|otp)|otp/i.test(m) ? 'Este link expirou ou já foi usado. Peça um novo.'
                : /fetch|network/i.test(m) ? 'Sem conexão. Verifique a internet.'
                  : m

const campo = 'h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm outline-none placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent/10'

function Senha({ value, onChange, autoComplete, autoFocus }: { value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [ver, setVer] = useState(false)
  return (
    <div className="relative">
      <input className={campo + ' pr-11'} type={ver ? 'text' : 'password'} required autoComplete={autoComplete} autoFocus={autoFocus} value={value} onChange={e => onChange(e.target.value)} />
      <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'} className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded-lg p-1.5 text-muted hover:text-fg">
        {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function Erro({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-sm text-danger"><CircleAlert className="mt-0.5 size-4 shrink-0" />{children}</p>
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#17120F] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-[#E4572E] opacity-30 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[420px] rounded-full bg-[#F59E0B] opacity-15 blur-[120px]" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#E4572E] font-bold">N</span>
          <div className="leading-tight"><div className="font-semibold">Painel NFC-e</div><div className="text-xs text-white/60">CAJUPAR</div></div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight">Todas as notas das lojas, num só lugar.</h1>
          <ul className="mt-8 flex flex-col gap-4 text-sm text-white/75">
            <li className="flex gap-3"><BarChart3 className="size-5 shrink-0 text-[#F26A3D]" />Faturamento, horários de pico e produtos por loja e mês</li>
            <li className="flex gap-3"><FileDown className="size-5 shrink-0 text-[#F26A3D]" />XML e DANFE em PDF de cada nota autorizada</li>
            <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-[#F26A3D]" />Notas protegidas: ninguém altera nem apaga</li>
          </ul>
        </div>
        <p className="relative text-xs text-white/40">Acesso restrito a usuários autorizados.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="anim-entrar w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-accent font-bold text-white">N</span>
            <div className="leading-tight"><div className="font-semibold">Painel NFC-e</div><div className="text-xs text-muted">CAJUPAR</div></div>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

export function TelaLogin({ erroLink }: { erroLink?: string }) {
  const [modo, setModo] = useState<'entrar' | 'esqueci' | 'enviado'>('entrar')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(erroLink ? traduzir(erroLink) : '')
  const [enviando, setEnviando] = useState(false)
  const [naoConfirmado, setNaoConfirmado] = useState(false)
  const [reenvio, setReenvio] = useState('')

  async function reenviar() {
    setReenvio('enviando')
    const { error } = await sb!.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: urlRetorno() } })
    setReenvio(error ? traduzir(error.message) : 'ok')
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!sb) return
    setEnviando(true); setErro('')
    if (modo === 'entrar') {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) setErro(traduzir(error.message))
      setNaoConfirmado(!!error && /email not confirmed/i.test(error.message)); setReenvio('')
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: urlRetorno() })
      if (error) setErro(traduzir(error.message)); else setModo('enviado')
    }
    setEnviando(false)
  }

  if (modo === 'enviado') return (
    <Moldura>
      <span className="grid size-12 place-items-center rounded-2xl bg-ok-soft text-ok"><MailCheck className="size-6" /></span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">Confira seu e-mail</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">Se <b className="text-fg">{email}</b> estiver cadastrado, você vai receber um link para criar uma nova senha. Ele vale por 1 hora. Veja também a caixa de spam.</p>
      <Button className="mt-8 w-full" onClick={() => setModo('entrar')}><ArrowLeft className="size-4" />Voltar para o login</Button>
    </Moldura>
  )

  return (
    <Moldura>
      <h2 className="text-2xl font-semibold tracking-tight">{modo === 'entrar' ? 'Entrar' : 'Esqueci minha senha'}</h2>
      <p className="mt-1.5 text-sm text-muted">{modo === 'entrar' ? 'Use o e-mail e a senha cadastrados pelo administrador.' : 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'}</p>
      <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">E-mail
          <input className={campo} type="email" autoComplete="username" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@cajupar.com" />
        </label>
        {modo === 'entrar' && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="flex items-center justify-between">Senha
              <button type="button" onClick={() => { setModo('esqueci'); setErro('') }} className="cursor-pointer text-xs font-medium text-accent hover:underline">Esqueci minha senha</button>
            </span>
            <Senha value={senha} onChange={setSenha} autoComplete="current-password" />
          </label>
        )}
        {erro && <Erro>{erro}</Erro>}
        {naoConfirmado && modo === 'entrar' && (
          reenvio === 'ok'
            ? <p className="flex items-start gap-2 rounded-xl bg-ok-soft px-3.5 py-2.5 text-sm text-ok"><MailCheck className="mt-0.5 size-4 shrink-0" />E-mail de confirmação reenviado para {email}. Veja também o spam.</p>
            : <>
                <Button type="button" onClick={reenviar} disabled={reenvio === 'enviando'}>
                  {reenvio === 'enviando' ? <LoaderCircle className="size-4 animate-spin" /> : <MailCheck className="size-4" />}Reenviar e-mail de confirmação
                </Button>
                {reenvio && reenvio !== 'enviando' && <Erro>{reenvio}</Erro>}
              </>
        )}
        <Button variant="primary" type="submit" disabled={enviando} className="h-11">
          {enviando && <LoaderCircle className="size-4 animate-spin" />}{modo === 'entrar' ? 'Entrar' : 'Enviar link'}
        </Button>
        {modo === 'esqueci' && <Button type="button" variant="ghost" onClick={() => { setModo('entrar'); setErro('') }}><ArrowLeft className="size-4" />Voltar</Button>}
      </form>
    </Moldura>
  )
}

export function TelaNovaSenha({ convite, onPronto }: { convite: boolean; onPronto: () => void }) {
  const [senha, setSenha] = useState('')
  const [conf, setConf] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const forca = [senha.length >= 8, /[a-z]/i.test(senha) && /\d/.test(senha), senha.length >= 12 || /[^a-z0-9]/i.test(senha)].filter(Boolean).length

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres.')
    if (senha !== conf) return setErro('As senhas não conferem.')
    setEnviando(true); setErro('')
    const { error } = await sb!.auth.updateUser({ password: senha })
    setEnviando(false)
    if (error) setErro(traduzir(error.message)); else onPronto()
  }

  return (
    <Moldura>
      <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent"><KeyRound className="size-6" /></span>
      <h2 className="mt-5 text-2xl font-semibold tracking-tight">{convite ? 'Bem-vindo! Crie sua senha' : 'Crie uma nova senha'}</h2>
      <p className="mt-1.5 text-sm text-muted">{convite ? 'Você foi convidado para o Painel NFC-e. Defina a senha que vai usar para entrar.' : 'Escolha a nova senha da sua conta.'}</p>
      <form onSubmit={salvar} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">Nova senha
          <Senha value={senha} onChange={setSenha} autoComplete="new-password" autoFocus />
          <span className="mt-1 flex gap-1">{[0, 1, 2].map(i => <span key={i} className={'h-1 flex-1 rounded-full ' + (i < forca ? (forca === 3 ? 'bg-ok' : forca === 2 ? 'bg-warn' : 'bg-danger') : 'bg-surface-3')} />)}</span>
          <span className="text-xs font-normal text-muted">Mínimo de 8 caracteres, com letras e números.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">Confirmar senha
          <Senha value={conf} onChange={setConf} autoComplete="new-password" />
        </label>
        {erro && <Erro>{erro}</Erro>}
        <Button variant="primary" type="submit" disabled={enviando} className="h-11">
          {enviando && <LoaderCircle className="size-4 animate-spin" />}Salvar senha e entrar
        </Button>
      </form>
    </Moldura>
  )
}
