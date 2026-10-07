// DANFE NFC-e (bobina 80mm) em PDF
import { fmtCnpj, payName, qf } from './format'
import type { Mes, Note } from './data'

interface ItemPdf { c: string; x: string; q: number; u: string; vu: number; v: number; d: number }
export interface ModeloPdf {
  espelho?: boolean; razao: string; fant: string; cnpj: string; ie: string; end: string
  nNF: string | number; serie: string; dhEmi: string; tpAmb: string; tpEmis: string
  itens: ItemPdf[]; vProd: number; vDesc: number; vOutro: number; vNF: number; vTotTrib: number
  pags: { t: string; v: number }[]; troco: number; dest: { doc: string; nome: string } | null
  qr: string; urlChave: string; chave: string; nProt: string; dhRecbto: string; infCpl: string
}

declare global {
  interface Window {
    jspdf: { jsPDF: new (o: object) => any }
    qrcode: (t: number, e: string) => { addData(s: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean }
  }
}

let libs: Promise<unknown> | null = null
const carregarJs = (src: string) => new Promise((res, rej) => {
  const s = document.createElement('script')
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('sem internet para carregar o gerador de PDF'))
  document.head.appendChild(s)
})
const prepararPdf = () => libs ||= Promise.all([
  carregarJs('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
  carregarJs('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'),
]).catch(e => { libs = null; throw e })

export function modeloDoXml(xml: string): ModeloPdf {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const q = (el: Element | Document | undefined, tag: string) => el ? el.getElementsByTagNameNS('*', tag)[0] : undefined
  const t = (el: Element | Document | undefined, tag: string) => (q(el, tag)?.textContent || '').trim()
  const all = (el: Element | Document | undefined, tag: string) => el ? [...el.getElementsByTagNameNS('*', tag)] : []
  const emit = q(doc, 'emit'), e = q(emit, 'enderEmit'), ide = q(doc, 'ide'), tot = q(doc, 'ICMSTot'), dest = q(doc, 'dest'), prot = q(doc, 'infProt'), pag = q(doc, 'pag')
  return {
    razao: t(emit, 'xNome'), fant: t(emit, 'xFant'), cnpj: t(emit, 'CNPJ'), ie: t(emit, 'IE'),
    end: [`${t(e, 'xLgr')}, ${t(e, 'nro')}${t(e, 'xCpl') ? ' ' + t(e, 'xCpl') : ''}`, t(e, 'xBairro'), `${t(e, 'xMun')}/${t(e, 'UF')}`, t(e, 'CEP') && 'CEP ' + t(e, 'CEP')].filter(Boolean).join(' - '),
    nNF: t(ide, 'nNF'), serie: t(ide, 'serie'), dhEmi: t(ide, 'dhEmi'), tpAmb: t(ide, 'tpAmb'), tpEmis: t(ide, 'tpEmis'),
    itens: all(doc, 'det').map(d => { const p = q(d, 'prod'); return { c: t(p, 'cProd'), x: t(p, 'xProd'), q: +t(p, 'qCom'), u: t(p, 'uCom'), vu: +t(p, 'vUnCom'), v: +t(p, 'vProd'), d: +t(p, 'vDesc') || 0 } }),
    vProd: +t(tot, 'vProd'), vDesc: +t(tot, 'vDesc') || 0, vOutro: (+t(tot, 'vOutro') || 0) + (+t(tot, 'vFrete') || 0), vNF: +t(tot, 'vNF'), vTotTrib: +t(tot, 'vTotTrib') || 0,
    pags: all(pag, 'detPag').map(p => ({ t: t(p, 'tPag'), v: +t(p, 'vPag') })), troco: +t(pag, 'vTroco') || 0,
    dest: dest ? { doc: t(dest, 'CPF') || t(dest, 'CNPJ'), nome: t(dest, 'xNome') } : null,
    qr: t(doc, 'qrCode'), urlChave: t(doc, 'urlChave'), chave: (q(doc, 'infNFe')?.getAttribute('Id') || '').replace(/^NFe/, ''),
    nProt: t(prot, 'nProt'), dhRecbto: t(prot, 'dhRecbto'), infCpl: t(doc, 'infCpl'),
  }
}

// Sem o XML: monta um espelho com o que o painel tem (sem QR Code e sem protocolo)
export function modeloDoPainel(n: Note, D: Mes): ModeloPdf {
  const pago = n.pays.reduce((s, p) => s + p.v, 0)
  return {
    espelho: true, razao: D.loja, fant: '', cnpj: D.cnpj, ie: '', end: D.end, nNF: n.n, serie: String(+n.chave.slice(22, 25)), dhEmi: n.dh, tpAmb: '1', tpEmis: n.chave[34],
    itens: n.items.map(i => { const p = D.prods[i.p] || []; return { c: p[0], x: p[1], q: i.q, u: '', vu: i.v / (i.q || 1), v: i.v, d: i.d } }),
    vProd: n.items.reduce((s, i) => s + i.v, 0), vDesc: n.desc, vOutro: 0, vNF: n.total, vTotTrib: 0,
    pags: n.pays.map(p => ({ t: p.c, v: p.v })), troco: Math.max(0, Math.round((pago - n.total) * 100) / 100),
    dest: null, qr: '', urlChave: '', chave: n.chave, nProt: '', dhRecbto: '', infCpl: n.info || '',
  }
}

export async function gerarPdf(m: ModeloPdf) {
  await prepararPdf()
  const { jsPDF } = window.jspdf
  const W = 80, M = 4, CW = W - 2 * M
  const v2 = (v: number) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const dh = (s: string) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 19)}` : ''
  const desenhar = (doc: any) => {
    let y = M + 3
    const fonte = (s: number, st = 'normal') => { doc.setFont('helvetica', st); doc.setFontSize(s) }
    const centro = (txt: string, s = 7, st?: string) => { fonte(s, st); for (const l of doc.splitTextToSize(String(txt), CW)) { doc.text(l, W / 2, y, { align: 'center' }); y += s * .42 } }
    const par = (a: string | number, b: string | number, s = 7, st?: string) => { fonte(s, st); doc.text(String(a), M, y); doc.text(String(b), W - M, y, { align: 'right' }); y += s * .42 }
    const linha = () => { y += .3; doc.setLineDashPattern([.6, .6], 0); doc.setLineWidth(.15); doc.line(M, y, W - M, y); y += 3 }

    centro(m.fant || m.razao, 8.5, 'bold')
    if (m.fant && m.fant !== m.razao) centro(m.razao, 6.5)
    centro(`CNPJ ${fmtCnpj(m.cnpj)}${m.ie ? '   IE ' + m.ie : ''}`, 6.5)
    centro(m.end, 6.5)
    linha()
    centro('DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', 6.5, 'bold')
    if (m.espelho) centro('ESPELHO GERADO PELO PAINEL - SEM VALOR FISCAL', 6.5, 'bold')
    linha()
    par('CÓDIGO / DESCRIÇÃO', 'QTD  UN  x  VL UNIT  =  VL TOTAL', 5.5, 'bold'); y += .6
    for (const i of m.itens) {
      fonte(6.5)
      for (const l of doc.splitTextToSize(`${i.c || ''}  ${i.x || ''}`, CW)) { doc.text(l, M, y); y += 2.7 }
      par('', `${qf.format(i.q)} ${i.u || ''} x ${v2(i.vu)} = ${v2(i.v)}`, 6.5)
      if (i.d) par('', `desconto -${v2(i.d)}`, 6)
      y += .6
    }
    linha()
    par('Qtde. total de itens', m.itens.length)
    par('Valor total R$', v2(m.vProd))
    if (m.vDesc) par('Descontos R$', '-' + v2(m.vDesc))
    if (m.vOutro) par('Acréscimos R$', v2(m.vOutro))
    par('Valor a pagar R$', v2(m.vNF), 8, 'bold')
    y += 1
    par('FORMA DE PAGAMENTO', 'VALOR PAGO R$', 6, 'bold')
    m.pags.forEach(p => par(payName(p.t), v2(p.v)))
    if (m.troco) par('Troco R$', v2(m.troco))
    linha()
    centro('Consulte pela Chave de Acesso em', 6.5, 'bold')
    centro(m.urlChave || 'portal da SEFAZ do estado emitente', 6.5)
    centro(m.chave.replace(/(\d{4})(?=\d)/g, '$1 '), 6.5)
    linha()
    const dd = m.dest?.doc || ''
    centro(dd ? `CONSUMIDOR - ${dd.length === 11 ? 'CPF ' + dd.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : 'CNPJ ' + fmtCnpj(dd)}${m.dest?.nome ? ' - ' + m.dest.nome : ''}` : 'CONSUMIDOR NÃO IDENTIFICADO', 6.5, 'bold')
    linha()
    centro(`NFC-e nº ${m.nNF}   Série ${m.serie}   ${dh(m.dhEmi)}`, 7, 'bold')
    if (m.nProt) { centro('Protocolo de autorização: ' + m.nProt, 6.5); centro('Data de autorização: ' + dh(m.dhRecbto), 6.5) }
    if (m.tpEmis === '9') centro('EMITIDA EM CONTINGÊNCIA', 7, 'bold')
    if (m.tpAmb === '2') centro('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL', 7, 'bold')
    if (m.qr) {
      const qr = window.qrcode(0, 'M'); qr.addData(m.qr); qr.make()
      const n = qr.getModuleCount(), lado = 34, c = lado / n, x0 = (W - lado) / 2
      y += 1; doc.setFillColor(0, 0, 0)
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) doc.rect(x0 + k * c, y + r * c, c + .02, c + .02, 'F')
      y += lado + 4
    }
    if (m.vTotTrib) centro(`Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${v2(m.vTotTrib)}`, 6)
    if (m.infCpl) { linha(); centro(m.infCpl, 6) }
    return y
  }
  const altura = desenhar(new jsPDF({ unit: 'mm', format: [W, 3000] })) + M
  const doc = new jsPDF({ unit: 'mm', format: [W, Math.max(altura, 90)] })
  desenhar(doc)
  doc.save(`NFCe-${m.chave}.pdf`)
}

export function baixar(nome: string, dados: Blob | string, tipo = 'application/octet-stream') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(dados instanceof Blob ? dados : new Blob([dados], { type: tipo }))
  a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
