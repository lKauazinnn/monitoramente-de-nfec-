-- =====================================================================
--  NF-e Control · migração 004 — busca de notas (filtros) e comparativo mensal
--  Rodar no SQL Editor (pode rodar de novo sem problema).
--  As funções rodam com as permissões de quem chama (security invoker):
--  continuam valendo as regras de leitura (só usuários logados).
-- =====================================================================

-- índices para filtrar por data e por loja + data
create index if not exists nfce_notas_dh      on public.nfce_notas (dh);
create index if not exists nfce_notas_cnpj_dh on public.nfce_notas (cnpj, dh);
create index if not exists nfce_notas_mes     on public.nfce_notas (mes);

-- ---------- busca com filtros ----------
-- Datas no formato aaaa-mm-dd (horário da emissão). Pagamento = código tPag (03 crédito, 04 débito, 17 PIX...).
-- Canal: 'entrega' ou 'salao' (lido do texto da venda em infCpl). Ordem: recentes | antigas | maior_valor | menor_valor
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
    select t.* from public.nfce_notas t
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

-- ---------- comparativo: vendas por item em cada mês ----------
create or replace function public.nfce_comparativo(p_meses text[], p_cnpjs text[] default null)
returns table (mes text, cprod text, xprod text, quantidade numeric, valor numeric, notas bigint)
language sql stable security invoker set search_path = public as $$
  select t.mes, e ->> 0, e ->> 1,
         sum((e ->> 2)::numeric),
         sum((e ->> 3)::numeric - coalesce((e ->> 4)::numeric, 0)),
         count(distinct t.chave)
  from public.nfce_notas t, jsonb_array_elements(t.itens) e
  where t.mes = any (p_meses)
    and (p_cnpjs is null or cardinality(p_cnpjs) = 0 or t.cnpj = any (p_cnpjs))
  group by 1, 2, 3
  order by 5 desc;
$$;

revoke execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) from public, anon;
grant  execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) to authenticated;
revoke execute on function public.nfce_comparativo(text[], text[]) from public, anon;
grant  execute on function public.nfce_comparativo(text[], text[]) to authenticated;
