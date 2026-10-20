-- =====================================================================
--  NF-e Control · migração 006 — busca rápida (corrige "statement timeout")
--  Rodar no SQL Editor (pode rodar de novo sem problema), depois da 005.
--
--  A nfce_buscar da 005 tinha filtros do tipo "(p_x is null or t.x = p_x)". Dentro de
--  função SQL o Postgres não consegue descartar esses OR, então não usava o índice
--  (cnpj, dh) e lia a tabela inteira a cada busca — com 2024-2026 importado passou do
--  tempo limite. Agora a consulta é montada só com os filtros preenchidos, e o total
--  (quantidade e soma) é calculado à parte, sem ordenar todas as linhas.
--  Mesmos parâmetros, mesmo retorno: o painel não muda.
-- =====================================================================

create index if not exists nfce_notas_cnpj_dh on public.nfce_notas (cnpj, dh);
create index if not exists nfce_notas_dh      on public.nfce_notas (dh);

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
language plpgsql stable security invoker set search_path = public as $$
declare
  w      text := 'true';
  ordem  text;
  v_qtd  bigint;
  v_soma numeric;
begin
  -- $1..$10 = filtros, na ordem do USING abaixo
  if cardinality(p_cnpjs) > 0   then w := w || ' and t.cnpj = any ($1)'; end if;
  if p_de  is not null           then w := w || ' and t.dh >= $2'; end if;
  if p_ate is not null           then w := w || ' and t.dh <= $3 || ''T23:59'''; end if;
  if p_numero is not null        then w := w || ' and t.n = $4'; end if;
  if p_chave is not null         then w := w || ' and t.chave like $5 || ''%'''; end if;
  if p_produto is not null       then w := w || ' and exists (select 1 from jsonb_array_elements(t.itens) e
                                                   where e ->> 1 ilike ''%'' || $6 || ''%'' or e ->> 0 = $6)'; end if;
  if p_pagamento is not null     then w := w || ' and t.pagamentos @> jsonb_build_array(jsonb_build_array($7))'; end if;
  if p_canal is not null         then w := w || ' and ($8 = ''entrega'') = (t.info ~* ''venda:\s*\d+\s*-\s*entrega'')'; end if;
  if p_min is not null           then w := w || ' and t.total >= $9'; end if;
  if p_max is not null           then w := w || ' and t.total <= $10'; end if;

  execute 'select count(*), coalesce(sum(t.total), 0) from public.nfce_notas_ativas t where ' || w
    into v_qtd, v_soma
    using p_cnpjs, p_de, p_ate, p_numero, p_chave, p_produto, p_pagamento, p_canal, p_min, p_max;
  if v_qtd = 0 then return; end if;

  ordem := case p_ordem
    when 'antigas'     then 't.dh asc, t.chave'
    when 'maior_valor' then 't.total desc, t.dh desc, t.chave'
    when 'menor_valor' then 't.total asc, t.dh desc, t.chave'
    else 't.dh desc, t.chave'
  end;

  return query execute
    'select t.chave, t.cnpj, t.mes, t.loja, t.endereco, t.n, t.dh,
            t.total::numeric, t.descontos::numeric, t.icms::numeric, t.pagamentos, t.info, t.itens, $11, $12
     from public.nfce_notas_ativas t where ' || w || ' order by ' || ordem || ' limit $13 offset $14'
    using p_cnpjs, p_de, p_ate, p_numero, p_chave, p_produto, p_pagamento, p_canal, p_min, p_max,
          v_qtd, v_soma, least(greatest(p_limite, 1), 1000), greatest(p_offset, 0);
end $$;

revoke execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) from public, anon;
grant  execute on function public.nfce_buscar(text[], text, text, int, text, text, text, text, numeric, numeric, text, int, int) to authenticated;

-- ---------- conferência (rodar à parte): deve voltar em menos de 1 s ----------
-- select qtd_total, soma_total, n, dh from public.nfce_buscar(p_de => '2024-01-01', p_ate => '2024-01-31', p_limite => 3);
