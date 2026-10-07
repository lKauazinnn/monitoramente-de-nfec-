// Função da Vercel para o painel de admin. Roda só no servidor: é o único lugar que usa a chave secret.
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   SUPABASE_URL          https://<projeto>.supabase.co
//   SUPABASE_SECRET_KEY   sb_secret_...  (NUNCA no front-end)
//   ADMIN_EMAILS          e-mails que sempre são admin, separados por vírgula (ex.: o primeiro administrador)
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
const ADMINS = (process.env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean)
const ORIGENS = ['https://monitoramente-de-nfec-phi.vercel.app', 'null'] // 'null' = painel aberto como arquivo local

const ehAdmin = u => !!u && (ADMINS.includes((u.email || '').toLowerCase()) || u.app_metadata?.papel === 'admin')
const papelDe = u => ehAdmin(u) ? 'admin' : 'usuario'
const desativado = u => !!u.banned_until && new Date(u.banned_until) > new Date()
const emailOk = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function resumo(u, imp) {
  return {
    id: u.id, email: u.email, nome: u.user_metadata?.nome || '', papel: papelDe(u), adminFixo: ADMINS.includes((u.email || '').toLowerCase()),
    criado: u.created_at, ultimoAcesso: u.last_sign_in_at || null, confirmado: !!(u.email_confirmed_at || u.confirmed_at),
    convitePendente: !!u.invited_at && !u.last_sign_in_at, desativado: desativado(u),
    notasImportadas: imp?.notas || 0, ultimaImportacao: imp?.ultima || null,
  }
}

export default async function handler(req, res) {
  const origem = req.headers.origin
  if (origem && ORIGENS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem)
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' })
  if (!URL || !SECRET) return res.status(500).json({ erro: 'Servidor sem SUPABASE_URL / SUPABASE_SECRET_KEY nas variáveis de ambiente da Vercel.' })

  const adm = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const { data: { user } = {}, error: eu } = token ? await adm.auth.getUser(token) : { error: true }
  if (eu || !user) return res.status(401).json({ erro: 'Sessão inválida. Entre de novo.' })

  const { acao, id, email, nome, papel, senha, redirectTo } = req.body || {}
  if (acao === 'eu') return res.json({ admin: ehAdmin(user) })
  if (!ehAdmin(user)) return res.status(403).json({ erro: 'Apenas administradores.' })

  const alvo = async () => {
    const { data, error } = await adm.auth.admin.getUserById(id)
    if (error || !data.user) throw new Error('Usuário não encontrado')
    return data.user
  }
  const retorno = typeof redirectTo === 'string' && /^https:\/\/monitoramente-de-nfec-phi\.vercel\.app\//.test(redirectTo) ? redirectTo : 'https://monitoramente-de-nfec-phi.vercel.app/'

  try {
    switch (acao) {
      case 'listar': {
        const usuarios = []
        for (let page = 1; ; page++) {
          const { data, error } = await adm.auth.admin.listUsers({ page, perPage: 1000 })
          if (error) throw error
          usuarios.push(...data.users)
          if (data.users.length < 1000) break
        }
        const { data: imps } = await adm.from('nfce_importacoes').select('*')
        const porUsuario = new Map((imps || []).map(i => [i.importado_por, i]))
        return res.json({ usuarios: usuarios.map(u => resumo(u, porUsuario.get(u.id))) })
      }
      case 'criar':
      case 'convidar': {
        if (!emailOk(email)) return res.status(400).json({ erro: 'E-mail inválido.' })
        const meta = { app_metadata: { papel: papel === 'admin' ? 'admin' : 'usuario' }, user_metadata: { nome: String(nome || '').slice(0, 120) } }
        if (acao === 'criar') {
          if (typeof senha !== 'string' || senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' })
          const { error } = await adm.auth.admin.createUser({ email: email.trim(), password: senha, email_confirm: true, ...meta })
          if (error) throw error
        } else {
          const { data, error } = await adm.auth.admin.inviteUserByEmail(email.trim(), { redirectTo: retorno, data: meta.user_metadata })
          if (error) throw error
          await adm.auth.admin.updateUserById(data.user.id, { app_metadata: meta.app_metadata })
        }
        return res.json({ ok: true })
      }
      case 'papel': {
        if (id === user.id) return res.status(400).json({ erro: 'Você não pode mudar o seu próprio papel.' })
        await alvo()
        const { error } = await adm.auth.admin.updateUserById(id, { app_metadata: { papel: papel === 'admin' ? 'admin' : 'usuario' } })
        if (error) throw error
        return res.json({ ok: true })
      }
      case 'desativar':
      case 'reativar': {
        if (id === user.id) return res.status(400).json({ erro: 'Você não pode desativar a sua própria conta.' })
        const u = await alvo()
        if (acao === 'desativar' && ADMINS.includes((u.email || '').toLowerCase())) return res.status(400).json({ erro: 'Este e-mail é administrador fixo (ADMIN_EMAILS).' })
        const { error } = await adm.auth.admin.updateUserById(id, { ban_duration: acao === 'desativar' ? '876000h' : 'none' })
        if (error) throw error
        return res.json({ ok: true })
      }
      case 'redefinir': {
        const u = await alvo()
        const { error } = await adm.auth.resetPasswordForEmail(u.email, { redirectTo: retorno })
        if (error) throw error
        return res.json({ ok: true })
      }
      default:
        return res.status(400).json({ erro: 'Ação desconhecida' })
    }
  } catch (e) {
    return res.status(400).json({ erro: e?.message || String(e) })
  }
}
