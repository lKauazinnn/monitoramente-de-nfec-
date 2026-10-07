import { createContext, useContext, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { brl, kf } from '../lib/format'

export interface Paleta { accent: string; soft: string; ink: string; grid: string; axis: string; cursor: string }
export const paleta = (dark: boolean): Paleta => dark
  ? { accent: '#F26A3D', soft: '#4A2A1E', ink: '#E4E4E7', grid: '#26262C', axis: '#71717A', cursor: 'rgba(255,255,255,.04)' }
  : { accent: '#E4572E', soft: '#F6CDBE', ink: '#3F3F46', grid: '#ECEAE5', axis: '#A19D96', cursor: 'rgba(23,23,26,.035)' }
export const PaletaCtx = createContext<Paleta>(paleta(false))

export interface Ponto { key: string; label: string; value: number; tip: ReactNode; destaque?: boolean }

function Dica({ active, payload }: { active?: boolean; payload?: { payload: Ponto }[] }) {
  if (!active || !payload?.length) return null
  return <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-xl">{payload[0].payload.tip}</div>
}

export function Barras({ data, selecionado, onSelect, altura = 240, cor }: {
  data: Ponto[]; selecionado?: string | null; onSelect?: (k: string) => void; altura?: number; cor?: (p: Ponto) => string
}) {
  const c = useContext(PaletaCtx)
  const fill = cor || ((p: Ponto) => !selecionado || selecionado === p.key ? c.accent : c.soft)
  return (
    <ResponsiveContainer width="100%" height={altura}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="16%">
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} interval="preserveStartEnd" minTickGap={2} />
        <YAxis tickFormatter={v => kf(+v)} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 11 }} width={38} />
        <Tooltip cursor={{ fill: c.cursor }} content={<Dica />} isAnimationActive={false} />
        <Bar
          dataKey="value"
          radius={[6, 6, 2, 2]}
          maxBarSize={56}
          animationDuration={500}
          style={onSelect ? { cursor: 'pointer' } : undefined}
          onClick={(_, i) => onSelect?.(data[i].key)}
        >
          {data.map(p => <Cell key={p.key} fill={fill(p)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function Rosca({ data, total }: { data: { name: string; value: number; color: string }[]; total: number }) {
  return (
    <div className="relative mx-auto size-44 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" paddingAngle={data.length > 1 ? 2 : 0} cornerRadius={4} stroke="none" animationDuration={500}>
            {data.map(d => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip isAnimationActive={false} content={({ active, payload }) => active && payload?.length
            ? <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-xl"><b>{payload[0].name}</b><div className="num">{brl.format(+payload[0].value!)}</div></div>
            : null} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <span className="text-[11px] text-muted">Total</span>
        <span className="num text-lg font-semibold tracking-tight">{kf(total)}</span>
      </div>
    </div>
  )
}
