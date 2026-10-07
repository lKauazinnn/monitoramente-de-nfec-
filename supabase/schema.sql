-- =====================================================================
--  PAINEL NFC-e · CAJUPAR — banco central no Supabase
--  Rodar uma vez no SQL Editor do projeto (pode rodar de novo sem problema).
--
--  Regras:
--   • qualquer pessoa com o link vê os números das notas (lojas, meses, itens, pagamentos)
--   • só usuários com login baixam o XML (o XML pode ter CPF do consumidor - LGPD)
--   • só usuários com login importam notas
--   • NINGUÉM apaga nem altera nota ou XML: não há permissão para isso e um
--     gatilho no banco recusa UPDATE/DELETE/TRUNCATE mesmo com a chave de administrador
-- =====================================================================

create table if not exists public.nfce_notas (
  chave         text primary key check (chave ~ '^\d{44}$'),
  cnpj          text not null check (cnpj ~ '^\d{14}$'),
  mes           text not null check (mes ~ '^\d{4}-\d{2}$'),
  loja          text not null,
  endereco      text not null default '',
  n             integer not null,
  dh            text not null,                 -- aaaa-mm-ddThh:mi (horário local da emissão)
  total         numeric(14,2) not null,
  descontos     numeric(14,2) not null default 0,
  icms          numeric(14,2) not null default 0,
  pagamentos    jsonb not null,                -- [[tPag, vPag], ...]
  info          text not null default '',      -- infCpl
  itens         jsonb not null,                -- [[cProd, xProd, qCom, vProd, vDesc], ...]
  importado_em  timestamptz not null default now(),
  importado_por uuid default auth.uid()
);
create index if not exists nfce_notas_cnpj_mes on public.nfce_notas (cnpj, mes);

create table if not exists public.nfce_xml (
  chave         text primary key references public.nfce_notas (chave),
  xml_gz        text not null,                 -- procNFe em gzip + base64
  importado_em  timestamptz not null default now(),
  importado_por uuid default auth.uid()
);

-- resumo por loja/mês (usado na visão geral)
create or replace view public.nfce_resumo with (security_invoker = on) as
  select cnpj, mes, max(loja) as loja, max(endereco) as endereco, count(*)::int as notas, sum(total)::float8 as total
  from public.nfce_notas group by cnpj, mes;

-- ---------- segurança ----------
alter table public.nfce_notas enable row level security;
alter table public.nfce_xml   enable row level security;

drop policy if exists "notas: leitura" on public.nfce_notas;
create policy "notas: leitura" on public.nfce_notas for select to anon, authenticated using (true);
-- Para exigir login também para ver os números, troque a linha acima por:
-- create policy "notas: leitura" on public.nfce_notas for select to authenticated using (true);

drop policy if exists "notas: importar" on public.nfce_notas;
create policy "notas: importar" on public.nfce_notas for insert to authenticated with check (importado_por = auth.uid());

drop policy if exists "xml: leitura" on public.nfce_xml;
create policy "xml: leitura" on public.nfce_xml for select to authenticated using (true);

drop policy if exists "xml: importar" on public.nfce_xml;
create policy "xml: importar" on public.nfce_xml for insert to authenticated with check (importado_por = auth.uid());

revoke update, delete, truncate on public.nfce_notas, public.nfce_xml from anon, authenticated;
grant select on public.nfce_resumo to anon, authenticated;

create or replace function public.nfce_impede_alteracao() returns trigger language plpgsql as $$
begin
  raise exception 'Notas fiscais e XMLs não podem ser alterados nem apagados (%).', tg_op;
end $$;

drop trigger if exists nfce_notas_imutavel on public.nfce_notas;
create trigger nfce_notas_imutavel before update or delete on public.nfce_notas for each row execute function public.nfce_impede_alteracao();
drop trigger if exists nfce_notas_sem_truncate on public.nfce_notas;
create trigger nfce_notas_sem_truncate before truncate on public.nfce_notas for each statement execute function public.nfce_impede_alteracao();
drop trigger if exists nfce_xml_imutavel on public.nfce_xml;
create trigger nfce_xml_imutavel before update or delete on public.nfce_xml for each row execute function public.nfce_impede_alteracao();
drop trigger if exists nfce_xml_sem_truncate on public.nfce_xml;
create trigger nfce_xml_sem_truncate before truncate on public.nfce_xml for each statement execute function public.nfce_impede_alteracao();
