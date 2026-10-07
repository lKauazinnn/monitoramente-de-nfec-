export const PAY: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Crédito', '04': 'Débito', '05': 'Crédito loja', '10': 'Vale-alimentação',
  '11': 'Vale-refeição', '12': 'Vale-presente', '13': 'Vale-combustível', '15': 'Boleto', '16': 'Depósito', '17': 'PIX',
  '18': 'Transferência', '19': 'Fidelidade', '90': 'Sem pagamento', '99': 'Outros',
}
const PAY_COLORS: Record<string, string> = {
  '03': '#E4572E', '04': '#6366F1', '17': '#10B981', '11': '#F59E0B', '10': '#84CC16',
  '01': '#A16207', '05': '#EC4899', '12': '#8B5CF6', '99': '#94A3B8',
}
export const payColor = (c: string) => PAY_COLORS[c] || '#A1A1AA'
export const payName = (c: string) => PAY[c] || c

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
export const nf = new Intl.NumberFormat('pt-BR')
export const qf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
export const qf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
export const kf = (v: number) => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : Math.round(v) + ''
export const pct = (x: number) => (x * 100).toFixed(1).replace('.', ',') + '%'
export const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
export const mesLabel = (m: string) => MES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4)
export const mesCurto = (m: string) => MES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4)
export const dayLabel = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return { wd: WD[d.getDay()], dm: iso.slice(8, 10) + '/' + iso.slice(5, 7) } }
export const cidade = (end: string) => (end.split(',').pop() || '').trim()
// endereço no formato "Rua, nº - BAIRRO, CIDADE/UF"
export const bairro = (end: string) => ((end.split(' - ')[1] || '').split(',')[0] || '').trim()
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a, c) => a + c.toUpperCase()).replace(/ (De|Da|Do|Das|Dos|E) /g, w => w.toLowerCase())
// Nome da unidade quando o admin não definiu um apelido: "Caju" + bairro (ex.: Caju Asa Norte)
export const nomeAuto = (loja: string, end: string) => { const b = bairro(end); return b ? 'Caju ' + titulo(b) : titulo(loja) }
export const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0)
