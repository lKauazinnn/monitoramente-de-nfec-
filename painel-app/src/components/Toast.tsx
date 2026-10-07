import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'
import { cx } from './ui'

export interface ToastOpts { tone?: 'info' | 'ok' | 'erro' | 'carregando'; fixo?: boolean; acao?: { label: string; onClick: () => void } }
interface T extends ToastOpts { msg: ReactNode; id: number }

const Ctx = createContext<(msg: ReactNode, o?: ToastOpts) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<T | null>(null)
  const timer = useRef<number>(undefined)
  const show = useCallback((msg: ReactNode, o: ToastOpts = {}) => {
    clearTimeout(timer.current)
    setT({ msg, ...o, id: Date.now() })
    if (!o.fixo && o.tone !== 'carregando') timer.current = window.setTimeout(() => setT(null), o.tone === 'erro' ? 10000 : 5000)
  }, [])
  const Icon = t?.tone === 'erro' ? CircleAlert : t?.tone === 'carregando' ? LoaderCircle : CircleCheck
  return (
    <Ctx.Provider value={show}>
      {children}
      {t && (
        <div key={t.id} role="status" className="anim-entrar fixed right-4 bottom-4 left-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xl sm:left-auto sm:mx-0">
          <Icon className={cx('mt-0.5 size-5 shrink-0', t.tone === 'erro' ? 'text-danger' : t.tone === 'carregando' ? 'animate-spin text-accent' : 'text-ok')} />
          <div className="min-w-0 flex-1 text-sm leading-relaxed">
            {t.msg}
            {t.acao && <button onClick={t.acao.onClick} className="mt-2 block cursor-pointer text-sm font-semibold text-accent hover:underline">{t.acao.label}</button>}
          </div>
          <button aria-label="Fechar" onClick={() => setT(null)} className="cursor-pointer rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-4" /></button>
        </div>
      )}
    </Ctx.Provider>
  )
}
