-- =====================================================================
--  PAINEL NFC-e · migração 003 — nome de exibição (apelido) de cada loja
--  Ex.: CNPJ 62.723.936/0001-06 "CAJU LIMAO" -> "Caju Itaim"
--  Rodar no SQL Editor (pode rodar de novo sem problema).
--  Quem lê: qualquer usuário logado. Quem altera: só admin, pelo painel (função /api/admin).
-- =====================================================================

create table if not exists public.nfce_lojas (
  cnpj           text primary key check (cnpj ~ '^\d{14}$'),
  apelido        text check (char_length(apelido) <= 60),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.nfce_lojas enable row level security;
drop policy if exists "lojas: leitura" on public.nfce_lojas;
create policy "lojas: leitura" on public.nfce_lojas for select to authenticated using (true);
revoke insert, update, delete, truncate on public.nfce_lojas from anon, authenticated;
