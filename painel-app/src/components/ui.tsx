import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-surface shadow-card', className)}>{children}</section>
}

export function CardHeader({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function Kpi({ label, value, sub, icon, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: 'default' | 'accent' }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className={cx('grid size-8 place-items-center rounded-lg', tone === 'accent' ? 'bg-accent text-white' : 'bg-surface-2 text-muted')}>{icon}</span>
      </div>
      <div className="num truncate text-[26px] leading-none font-semibold tracking-tight">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </Card>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md' | 'icon' }
export function Button({ variant = 'secondary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:shrink-0',
        size === 'sm' ? 'h-8 px-3 text-xs' : size === 'icon' ? 'size-10' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
        variant === 'secondary' && 'border border-line bg-surface text-fg hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        className,
      )}
    />
  )
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx('relative', className)}>
      <select
        {...p}
        className="h-10 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-surface pr-9 pl-3.5 text-sm font-medium text-fg outline-none hover:bg-surface-2 focus-visible:border-accent"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: [T, string][]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex gap-0.5 rounded-xl bg-surface-3 p-1">
      {options.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={cx(
            'cursor-pointer rounded-lg font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' }) {
  return (
    <span className={cx(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
      tone === 'neutral' && 'bg-surface-2 text-muted',
      tone === 'accent' && 'bg-accent-soft text-accent-strong',
      tone === 'ok' && 'bg-ok-soft text-ok',
      tone === 'warn' && 'bg-warn-soft text-warn',
    )}>{children}</span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-surface-3', className)} />
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</span>
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}
