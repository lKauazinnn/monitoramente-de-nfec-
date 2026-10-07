import { useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileCode2, FileDown, LoaderCircle, LogIn, X } from 'lucide-react'
import { buscarXml, type Mes, type Note } from '../lib/data'
import { brl, payName, qf } from '../lib/format'
import { baixar, gerarPdf, modeloDoPainel, modeloDoXml } from '../lib/pdf'
import { SessaoCtx } from './Sessao'
import { useToast } from './Toast'
import { Badge, Button } from './ui'

export function NoteDrawer({ note: n, mes: D, onClose }: { note: Note; mes: Mes; onClose: () => void }) {
  const toast = useToast()
  const [temXml, setTemXml] = useState<boolean | null>(null)
  const [gerando, setGerando] = useState(false)
  const { remoto, email, pedirLogin } = useContext(SessaoCtx)
  const precisaLogin = remoto && !email

  useEffect(() => {
    if (precisaLogin) return setTemXml(null)
    buscarXml(n.chave).then(x => setTemXml(!!x), () => setTemXml(false))
  }, [n.chave, precisaLogin])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])

  async function xml() {
    const x = await buscarXml(n.chave).catch(() => null)
    if (!x) return toast(remoto ? 'O XML desta nota ainda não está no banco. Importe o CSV do SSMS que contém a nota.' : 'O XML desta nota não está neste navegador. Clique em Importar CSV e selecione o CSV do SSMS que contém a nota.', { tone: 'erro' })
    baixar(`${n.chave}-procNFe.xml`, x, 'application/xml')
  }
  async function pdf() {
    setGerando(true)
    try {
      const x = precisaLogin ? null : await buscarXml(n.chave).catch(() => null)
      await gerarPdf(x ? modeloDoXml(x) : modeloDoPainel(n, D))
      toast(x ? 'PDF gerado.' : 'PDF gerado como espelho: sem o XML desta nota, ele sai sem QR Code e protocolo. Importe o CSV do mês para ter o DANFE completo.', { tone: x ? 'ok' : 'erro' })
    } catch (e) { toast('Erro ao gerar PDF: ' + (e as Error).message, { tone: 'erro' }) }
    setGerando(false)
  }

  const dt = `${n.dh.slice(8, 10)}/${n.dh.slice(5, 7)}/${n.dh.slice(0, 4)} ${n.dh.slice(11, 16)}`
  const bruto = n.items.reduce((s, i) => s + i.v, 0)
  const resumo: [string, number][] = [['Subtotal', bruto], ['Desconto', n.desc], ['ICMS', n.icms]]

  return createPortal(
    <>
      <div className="anim-fade fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="anim-gaveta fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl" role="dialog" aria-label={`NFC-e ${n.n}`}>
        <header className="flex items-start justify-between gap-3 border-b border-line p-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-mono text-[11px] tracking-wider text-muted uppercase">NFC-e nº {n.n}</span>
            <span className="num text-3xl font-semibold tracking-tight">{brl.format(n.total)}</span>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <span>{dt}</span>
              <Badge tone={n.canal === 'entrega' ? 'ok' : 'accent'}>{n.canal === 'entrega' ? 'Entrega' : 'Salão'}</Badge>
              <span>{n.ref} · venda {n.venda}</span>
            </div>
          </div>
          <button aria-label="Fechar" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-5" /></button>
        </header>

        <div className="grid grid-cols-2 gap-2 border-b border-line p-4">
          {precisaLogin
            ? <Button onClick={pedirLogin}><LogIn className="size-4" />Entrar p/ XML</Button>
            : <Button onClick={xml} disabled={temXml === false} title={temXml === false ? 'Importe o CSV do mês para ter o XML' : ''}><FileCode2 className="size-4" />Baixar XML</Button>}
          <Button variant="primary" onClick={pdf} disabled={gerando}>{gerando ? <LoaderCircle className="size-4 animate-spin" /> : <FileDown className="size-4" />}Baixar PDF</Button>
          {precisaLogin && <p className="col-span-2 text-xs text-muted">Entre com seu usuário para baixar o XML e o DANFE completo. Sem login, o PDF sai como espelho, sem QR Code.</p>}
          {temXml === false && <p className="col-span-2 text-xs text-muted">O XML desta nota {remoto ? 'ainda não está no banco' : 'não está neste navegador'}. O PDF sai como espelho, sem QR Code. Importe o CSV do SSMS do mês para liberar o XML e o DANFE completo.</p>}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-6 pb-6">
          <ul>
            {n.items.map((i, k) => {
              const p = D.prods[i.p] || []
              return (
                <li key={k} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-line py-3 text-sm">
                  <span className="font-medium">{p[1]}</span>
                  <span className="num text-right">{brl.format(i.v)}</span>
                  <span className="font-mono text-[11px] text-muted">{qf.format(i.q)} × {brl.format(i.v / (i.q || 1))} · cód {p[0]}</span>
                  <span className="num text-right font-mono text-[11px] text-accent">{i.d ? '− ' + brl.format(i.d) : ''}</span>
                </li>
              )
            })}
          </ul>
          <dl className="mt-4 flex flex-col gap-2 rounded-xl bg-surface-2 p-4 text-sm">
            {resumo.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="num">{brl.format(v)}</dd></div>)}
            <div className="my-1 border-t border-line" />
            {n.pays.map((p, k) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{payName(p.c)}</dt><dd className="num font-medium">{brl.format(p.v)}</dd></div>)}
          </dl>
          <p className="mt-4 font-mono text-[10px] break-all text-subtle">Chave {n.chave}</p>
        </div>
      </aside>
    </>,
    document.body,
  )
}
