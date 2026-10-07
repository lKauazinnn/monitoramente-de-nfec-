-- =====================================================================
--  PAINEL NFC-e · migração 002 — sistema fechado por login + painel de admin
--  Rodar no SQL Editor DEPOIS do schema.sql (pode rodar de novo sem problema).
-- =====================================================================

-- 1) Ver as notas agora exige login (antes qualquer pessoa com o link via os números)
drop policy if exists "notas: leitura" on public.nfce_notas;
create policy "notas: leitura" on public.nfce_notas for select to authenticated using (true);
revoke select on public.nfce_resumo from anon;
revoke all on public.nfce_notas, public.nfce_xml from anon;

-- 2) Quantas notas cada usuário importou (lido só pelo painel de admin, no servidor)
create or replace view public.nfce_importacoes as
  select importado_por, count(*)::int as notas, max(importado_em) as ultima
  from public.nfce_notas group by importado_por;
revoke all on public.nfce_importacoes from anon, authenticated;
grant select on public.nfce_importacoes to service_role;
