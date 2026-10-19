// Leitura de .zip direto no navegador (sem biblioteca): diretório central, ZIP64 e deflate.
// Lê o arquivo em janelas de 16 MB, então ZIPs grandes (centenas de MB, 90 mil XMLs) não estouram a memória.
const JANELA = 16 << 20

interface Entrada { nome: string; metodo: number; tam: number; offset: number; flags: number }

const u16 = (d: DataView, o: number) => d.getUint16(o, true)
const u32 = (d: DataView, o: number) => d.getUint32(o, true)
const u64 = (d: DataView, o: number) => Number(d.getBigUint64(o, true))

async function ler(f: Blob, ini: number, fim: number) {
  return new DataView(await f.slice(ini, fim).arrayBuffer())
}

async function entradas(f: Blob): Promise<Entrada[]> {
  const cauda = Math.min(f.size, 65557 + 20)
  const t = await ler(f, f.size - cauda, f.size)
  let p = -1
  for (let i = t.byteLength - 22; i >= 0; i--) if (u32(t, i) === 0x06054b50) { p = i; break }
  if (p < 0) throw new Error('arquivo .zip inválido ou corrompido')
  let qtd = u16(t, p + 10), tamCd = u32(t, p + 12), offCd = u32(t, p + 16)
  if (qtd === 0xFFFF || tamCd === 0xFFFFFFFF || offCd === 0xFFFFFFFF) {   // ZIP64 (mais de 65.535 arquivos ou mais de 4 GB)
    if (p < 20 || u32(t, p - 20) !== 0x07064b50) throw new Error('ZIP64 sem localizador')
    const z = await ler(f, u64(t, p - 12), u64(t, p - 12) + 56)
    if (u32(z, 0) !== 0x06064b50) throw new Error('ZIP64 corrompido')
    qtd = u64(z, 32); tamCd = u64(z, 40); offCd = u64(z, 48)
  }
  const cd = await ler(f, offCd, offCd + tamCd)
  const dec = new TextDecoder()
  const lista: Entrada[] = []
  for (let o = 0, i = 0; i < qtd; i++) {
    if (u32(cd, o) !== 0x02014b50) throw new Error('diretório do .zip corrompido')
    const flags = u16(cd, o + 8), metodo = u16(cd, o + 10)
    let tam = u32(cd, o + 20), offset = u32(cd, o + 42)
    const nl = u16(cd, o + 28), el = u16(cd, o + 30), cl = u16(cd, o + 32)
    const nome = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + o + 46, nl))
    if (tam === 0xFFFFFFFF || offset === 0xFFFFFFFF) {   // campos de 64 bits no "extra" 0x0001
      for (let e = o + 46 + nl; e < o + 46 + nl + el; e += 4 + u16(cd, e + 2)) {
        if (u16(cd, e) !== 1) continue
        let k = e + 4
        if (u32(cd, o + 24) === 0xFFFFFFFF) k += 8
        if (tam === 0xFFFFFFFF) { tam = u64(cd, k); k += 8 }
        if (offset === 0xFFFFFFFF) offset = u64(cd, k)
      }
    }
    if (!nome.endsWith('/')) lista.push({ nome, metodo, tam, offset, flags })
    o += 46 + nl + el + cl
  }
  return lista.sort((a, b) => a.offset - b.offset)
}

async function inflar(dados: Uint8Array) {
  const s = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

// Chama cb(nome, conteúdo) para cada arquivo do .zip cujo nome passa no filtro
export async function lerZip(f: Blob, filtro: (nome: string) => boolean, cb: (nome: string, dados: Uint8Array, i: number, total: number) => unknown) {
  const lista = (await entradas(f)).filter(e => filtro(e.nome))
  let jIni = 0, jan = new DataView(new ArrayBuffer(0))
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i]
    if (e.flags & 1) throw new Error(`${e.nome}: arquivo protegido por senha`)
    if (e.metodo !== 0 && e.metodo !== 8) throw new Error(`${e.nome}: compressão não suportada (${e.metodo})`)
    const precisa = 30 + 65535 * 2 + e.tam
    if (e.offset < jIni || e.offset + precisa > jIni + jan.byteLength) {
      jIni = e.offset
      jan = await ler(f, jIni, Math.min(f.size, jIni + Math.max(JANELA, precisa)))
    }
    const o = e.offset - jIni
    if (u32(jan, o) !== 0x04034b50) throw new Error(`${e.nome}: cabeçalho corrompido no .zip`)
    const ini = o + 30 + u16(jan, o + 26) + u16(jan, o + 28)
    const bruto = new Uint8Array(jan.buffer, jan.byteOffset + ini, e.tam)
    await cb(e.nome, e.metodo === 8 ? await inflar(bruto) : bruto.slice(), i + 1, lista.length)
  }
  return lista.length
}
