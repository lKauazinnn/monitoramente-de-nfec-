// Base local do navegador (IndexedDB) com as notas e XMLs importados.
// Não existe função de apagar: o que foi importado só é acrescentado ou atualizado.
type Store = 'xml' | 'mes'

const mem = { xml: new Map<string, unknown>(), mes: new Map<string, unknown>() }
let aberto: Promise<IDBDatabase | null> | undefined

const open = () => aberto ||= new Promise(res => {
  try {
    const r = indexedDB.open('nfce-cajupar', 1)
    r.onupgradeneeded = () => { r.result.createObjectStore('xml'); r.result.createObjectStore('mes') }
    r.onsuccess = () => res(r.result)
    r.onerror = r.onblocked = () => res(null)
  } catch { res(null) }
})

function run<T>(db: IDBDatabase, st: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise((res, rej) => {
    const t = db.transaction(st, mode), r = fn(t.objectStore(st))
    t.oncomplete = () => res((r ? r.result : undefined) as T)
    t.onerror = t.onabort = () => rej(t.error)
  })
}

export const DB = {
  async get<T>(st: Store, k: string): Promise<T | undefined> {
    const db = await open()
    return db ? run<T>(db, st, 'readonly', s => s.get(k)) : mem[st].get(k) as T | undefined
  },
  async all<T>(st: Store): Promise<T[]> {
    const db = await open()
    return db ? run<T[]>(db, st, 'readonly', s => s.getAll()) : [...mem[st].values()] as T[]
  },
  async put(st: Store, entries: [string, unknown][]) {
    const db = await open()
    if (!db) { entries.forEach(([k, v]) => mem[st].set(k, v)); return }
    await run(db, st, 'readwrite', s => { entries.forEach(([k, v]) => s.put(v, k)) })
  },
  async count(st: Store): Promise<number> {
    const db = await open()
    return db ? run<number>(db, st, 'readonly', s => s.count()) : mem[st].size
  },
  disponivel: async () => !!(await open()),
}

// Pede ao navegador para não apagar a base sozinho quando faltar espaço
export async function protegerArmazenamento(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch { return false }
}

export const gz = (blob: Blob, modo: 'c' | 'd' = 'd') =>
  new Response(blob.stream().pipeThrough(modo === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip')))

export async function xmlDa(chave: string): Promise<string | null> {
  const b = await DB.get<Blob>('xml', chave)
  return b ? gz(b).text() : null
}
