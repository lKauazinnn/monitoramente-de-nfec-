// Banco central (Supabase). Os valores vêm de variáveis de ambiente, fora do código:
//   local:  painel-app/.env.local (modelo em .env.example, não vai para o Git)
//   Vercel: Settings > Environment Variables
// Só a chave PUBLISHABLE pode ir para o navegador (é pública por natureza; quem protege os dados são as
// regras de supabase/*.sql). A secret fica apenas na função /api/admin, no servidor.
// Sem as variáveis, o painel funciona no modo local (dados publicados + importações no navegador).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || ''
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''

// Função de admin (Vercel). Com o painel aberto como arquivo local, usa a do site publicado.
export const SITE = 'https://monitoramente-de-nfec-phi.vercel.app/'
export const API_ADMIN = (location.protocol === 'file:' ? SITE.slice(0, -1) : '') + '/api/admin'
