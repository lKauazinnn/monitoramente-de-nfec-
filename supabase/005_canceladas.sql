-- =====================================================================
--  NF-e Control · migração 005 — canceladas e repetidas fora do faturamento
--  Rodar no SQL Editor (pode rodar de novo sem problema), depois da 004.
--
--  As notas continuam guardadas (nunca são alteradas nem apagadas); o que muda é
--  o que entra nos totais. Ficam de fora:
--   1) CANCELADAS (tabela nfce_canceladas, imutável), importadas pelo painel a partir de:
--      • eventos 110111 (cancelamento) e 110112 (cancelamento por substituição) dos XMLs/ZIPs do emissor
--      • pasta "Canceladas" do ZIP exportado pelo emissor
--      • relatório do emissor com a situação "Cancelada"
--      • lista exportada do SSMS (PASSO 3 da CONSULTA-SSMS.sql)
--   2) REPETIDAS (tabela nfce_repetidas, recalculada por nfce_marcar_repetidas):
--      a mesma venda do PDV emitida em duas notas — mesma loja, mesmo nº de venda,
--      mesma ficha/mesa/entrega, mesmo valor e mesmos itens, até 30 min de diferença.
--      Fica a de contingência (tpEmis 9, que substitui a online) ou, se forem do
--      mesmo tipo, a primeira; a outra sai do total.
-- =====================================================================

create table if not exists public.nfce_canceladas (
  chave            text primary key check (chave ~ '^\d{44}$'),
  cnpj             text not null check (cnpj ~ '^\d{14}$'),
  tipo             text not null,                  -- 110111 | 110112 | pasta Canceladas | relatório: ...
  protocolo        text not null default '',       -- nProt do evento na SEFAZ
  cstat            text not null default '',       -- 135 / 136 / 155 = evento registrado
  dh_evento        text not null default '',
  chave_substituta text not null default '',       -- no 110112: a nota (contingência) que substituiu esta
  origem           text not null default '',       -- arquivo de onde veio
  importado_em     timestamptz not null default now(),
  importado_por    uuid default auth.uid()
);
create index if not exists nfce_canceladas_cnpj on public.nfce_canceladas (cnpj);

alter table public.nfce_canceladas enable row level security;
drop policy if exists "canceladas: leitura" on public.nfce_canceladas;
create policy "canceladas: leitura" on public.nfce_canceladas for select to authenticated using (true);
drop policy if exists "canceladas: importar" on public.nfce_canceladas;
create policy "canceladas: importar" on public.nfce_canceladas for insert to authenticated with check (importado_por = auth.uid());
revoke all on public.nfce_canceladas from anon;
revoke update, delete, truncate on public.nfce_canceladas from authenticated;

drop trigger if exists nfce_canceladas_imutavel on public.nfce_canceladas;
create trigger nfce_canceladas_imutavel before update or delete on public.nfce_canceladas for each row execute function public.nfce_impede_alteracao();
drop trigger if exists nfce_canceladas_sem_truncate on public.nfce_canceladas;
create trigger nfce_canceladas_sem_truncate before truncate on public.nfce_canceladas for each statement execute function public.nfce_impede_alteracao();

-- ---------- repetidas: mesma venda do PDV em duas notas ----------
-- Dado derivado (não é documento fiscal): pode ser recalculado a qualquer momento.
create table if not exists public.nfce_repetidas (
  chave      text primary key,
  cnpj       text not null,
  fica       text not null,                -- a nota da mesma venda que continua valendo
  motivo     text not null,
  marcado_em timestamptz not null default now()
);
create index if not exists nfce_repetidas_cnpj on public.nfce_repetidas (cnpj);
alter table public.nfce_repetidas enable row level security;
drop policy if exists "repetidas: leitura" on public.nfce_repetidas;
create policy "repetidas: leitura" on public.nfce_repetidas for select to authenticated using (true);
revoke all on public.nfce_repetidas from anon;
revoke insert, update, delete, truncate on public.nfce_repetidas from authenticated;   -- só a função abaixo grava

-- Recalcula as repetidas das lojas informadas (null = todas). O painel chama depois de cada importação.
create or replace function public.nfce_marcar_repetidas(p_cnpjs text[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.nfce_repetidas r where p_cnpjs is null or cardinality(p_cnpjs) = 0 or r.cnpj = any (p_cnpjs);
  with base as (
    select t.chave, t.cnpj, t.total, md5(t.itens::text) as itens, substr(t.chave, 35, 1) as tp, left(t.dh, 16)::timestamp as dh,
           regexp_match(t.info, 'venda:\s*(\d+)\s*-\s*(ficha|entrega|mesa|comanda)\s*(\d+)', 'i') as m
    from public.nfce_notas t
    where (p_cnpjs is null or cardinality(p_cnpjs) = 0 or t.cnpj = any (p_cnpjs))
      and t.total > 0 and t.dh ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
      and not exists (select 1 from public.nfce_canceladas c where c.chave = t.chave)
  ), v as (
    select chave, cnpj, total, itens, tp, dh, m[1] as venda, lower(m[2]) || ' ' || m[3] as ref from base where m is not null
  )
  insert into public.nfce_repetidas (chave, cnpj, fica, motivo)
  select distinct on (b.chave) b.chave, b.cnpj, k.chave,
         case when k.tp = '9' and b.tp <> '9' then 'online + contingência da mesma venda' else 'mesma venda emitida duas vezes' end
  from v b join v k
    on k.cnpj = b.cnpj and k.venda = b.venda and k.ref = b.ref and k.total = b.total and k.itens = b.itens and k.chave <> b.chave
   and abs(extract(epoch from b.dh - k.dh)) <= 1800
   and ((k.tp = '9' and b.tp <> '9') or (k.tp = b.tp and k.chave < b.chave))
  order by b.chave, k.chave;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.nfce_marcar_repetidas(text[]) from public, anon;
grant execute on function public.nfce_marcar_repetidas(text[]) to authenticated;

-- ---------- notas válidas (o que o painel mostra e soma) ----------
create or replace view public.nfce_notas_ativas with (security_invoker = on) as
  select n.* from public.nfce_notas n
  where not exists (select 1 from public.nfce_canceladas c where c.chave = n.chave)
    and not exists (select 1 from public.nfce_repetidas r where r.chave = n.chave);
revoke all on public.nfce_notas_ativas from anon;
grant select on public.nfce_notas_ativas to authenticated;

-- resumo por loja/mês: notas e total já sem canceladas e repetidas; as demais colunas mostram o que ficou de fora
create or replace view public.nfce_resumo with (security_invoker = on) as
  select n.cnpj, n.mes, max(n.loja) as loja, max(n.endereco) as endereco,
         (count(*) filter (where c.chave is null and r.chave is null))::int as notas,
         coalesce(sum(n.total) filter (where c.chave is null and r.chave is null), 0)::float8 as total,
         count(c.chave)::int as canceladas,
         coalesce(sum(n.total) filter (where c.chave is not null), 0)::float8 as total_cancelado,
         (count(r.chave) filter (where c.chave is null))::int as repetidas,
         coalesce(sum(n.total) filter (where r.chave is not null and c.chave is null), 0)::float8 as total_repetido
  from public.nfce_notas n
  left join public.nfce_canceladas c on c.chave = n.chave
  left join public.nfce_repetidas r on r.chave = n.chave
  group by n.cnpj, n.mes;
revoke all on public.nfce_resumo from anon;
grant select on public.nfce_resumo to authenticated;

-- ---------- busca e comparativo passam a ler só as notas válidas ----------
create or replace function public.nfce_buscar(
  p_cnpjs     text[]  default null,
  p_de        text    default null,
  p_ate       text    default null,
  p_numero    int     default null,
  p_chave     text    default null,
  p_produto   text    default null,
  p_pagamento text    default null,
  p_canal     text    default null,
  p_min       numeric default null,
  p_max       numeric default null,
  p_ordem     text    default 'recentes',
  p_limite    int     default 50,
  p_offset    int     default 0
)
returns table (
  chave text, cnpj text, mes text, loja text, endereco text, n int, dh text,
  total numeric, descontos numeric, icms numeric, pagamentos jsonb, info text, itens jsonb,
  qtd_total bigint, soma_total numeric
)
language sql stable security invoker set search_path = public as $$
  with f as (
    select t.* from public.nfce_notas_ativas t
    where (p_cnpjs is null or cardinality(p_cnpjs) = 0 or t.cnpj = any (p_cnpjs))
      and (p_de is null or t.dh >= p_de)
      and (p_ate is null or t.dh <= p_ate || 'T23:59')
      and (p_numero is null or t.n = p_numero)
      and (p_chave is null or t.chave like p_chave || '%')
      and (p_min is null or t.total >= p_min)
      and (p_max is null or t.total <= p_max)
      and (p_pagamento is null or t.pagamentos @> jsonb_build_array(jsonb_build_array(p_pagamento)))
      and (p_canal is null or (p_canal = 'entrega') = (t.info ~* 'venda:\s*\d+\s*-\s*entrega'))
      and (p_produto is null or exists (
            select 1 from jsonb_array_elements(t.itens) e
            where e ->> 1 ilike '%' || p_produto || '%' or e ->> 0 = p_produto))
  )
  select f.chave, f.cnpj, f.mes, f.loja, f.endereco, f.n, f.dh, f.total, f.descontos, f.icms, f.pagamentos, f.info, f.itens,
         count(*) over () as qtd_total, sum(f.total) over () as soma_total
  from f
  order by
    case when p_ordem = 'antigas'     then f.dh    end asc,
    case when p_ordem = 'maior_valor' then f.total end desc,
    case when p_ordem = 'menor_valor' then f.total end asc,
    f.dh desc, f.chave
  limit least(greatest(p_limite, 1), 1000) offset greatest(p_offset, 0);
$$;

create or replace function public.nfce_comparativo(p_meses text[], p_cnpjs text[] default null)
returns table (mes text, cprod text, xprod text, quantidade numeric, valor numeric, notas bigint)
language sql stable security invoker set search_path = public as $$
  select t.mes, e ->> 0, e ->> 1,
         sum((e ->> 2)::numeric),
         sum((e ->> 3)::numeric - coalesce((e ->> 4)::numeric, 0)),
         count(distinct t.chave)
  from public.nfce_notas_ativas t, jsonb_array_elements(t.itens) e
  where t.mes = any (p_meses)
    and (p_cnpjs is null or cardinality(p_cnpjs) = 0 or t.cnpj = any (p_cnpjs))
  group by 1, 2, 3
  order by 5 desc;
$$;

revoke execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) from public, anon;
grant  execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) to authenticated;
revoke execute on function public.nfce_comparativo(text[], text[]) from public, anon;
grant  execute on function public.nfce_comparativo(text[], text[]) to authenticated;

-- marca as repetidas do que já está no banco
select public.nfce_marcar_repetidas() as repetidas_marcadas;

-- ---------- conferência (rodar à parte quando quiser) ----------
-- select cnpj, mes, notas, round(total::numeric, 2) as faturamento, canceladas, round(total_cancelado::numeric, 2) as cancelado,
--        repetidas, round(total_repetido::numeric, 2) as repetido
-- from public.nfce_resumo order by cnpj, mes;
-- select * from public.nfce_repetidas order by cnpj, chave;   -- cada repetida e a nota que ficou valendo
