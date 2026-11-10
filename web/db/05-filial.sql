-- =============================================================================
-- Relatório 146 — filiais com a UF (2026-11-10, pedido do Júlio: "Filial 1 · ES" como na 146)
-- O "ES" da rotina 146 é a filial 1; a "Região (equipes)" do painel é a equipe do supervisor.
-- Para o filtro de filial não confundir, a filial aparece com a UF e a cidade do cadastro (PCFILIAL).
-- Gravado pelo AGENTE LUBE (fluxo relatorio146.filial, de hora em hora). Redefine montar_pacote
-- (01-schema.sql) só para pôr a lista 'fil' no pacote.
-- =============================================================================

create table if not exists relatorio146.filial (
  codfilial text primary key, fantasia text, cidade text, uf text
);
alter table relatorio146.filial enable row level security;
revoke all on relatorio146.filial from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on relatorio146.filial from anon, authenticated;
  end if;
end $$;
comment on table relatorio146.filial is 'PCFILIAL: fantasia, cidade e UF de cada filial, para mostrar "Filial 1 · ES" no painel. Gravado pelo AGENTE LUBE.';

create or replace function relatorio146.montar_pacote(p_desde date, p_ate date)
returns json
language sql
stable
set search_path = relatorio146, pg_temp
as $$
with p as (
  select pe.*, coalesce(dc.uf, pe.uf) as uf_atual
    from relatorio146.pedido pe
    left join core.dim_cliente dc on dc.codcli = pe.codcli
   where pe.data >= p_desde and (p_ate is null or pe.data <= p_ate)
),
g as (
  select data, uf_atual as uf, codsupervisor, codusur, codfilial,
         count(*) as q,
         sum(venda) as v,
         case when count(custo_liq) = 0 then null else sum(coalesce(venda, 0)) - sum(custo_liq) end as l
    from p
   group by data, uf_atual, codsupervisor, codusur, codfilial
),
o as (
  select g.*, row_number() over (order by data, uf, codsupervisor, codusur, codfilial) as rn from g
),
sup as (
  select distinct on (p.codsupervisor) p.codsupervisor, coalesce(ds.nome, p.supervisor) as nome
    from p left join core.dim_supervisor ds on ds.codsupervisor = p.codsupervisor
   where p.codsupervisor is not null
   order by p.codsupervisor, p.data desc
),
rca as (
  select distinct on (p.codusur) p.codusur, coalesce(dr.nome, p.rca) as nome
    from p left join core.dim_rca dr on dr.codusur = p.codusur
   order by p.codusur, p.data desc
)
select json_build_object(
  'meta', json_build_object(
     'gerado_em', now(),
     'hoje',      to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
     'base',      '2025-01-01',
     'desde',     to_char(p_desde, 'YYYY-MM-DD'),
     'ate',       to_char(p_ate, 'YYYY-MM-DD'),
     'pedidos',   (select count(*) from p),
     'ult_pedido', (select to_char(max(make_timestamp(extract(year from data)::int, extract(month from data)::int,
                                    extract(day from data)::int, coalesce(hora, 0)::int, coalesce(minuto, 0)::int, 0)), 'YYYY-MM-DD"T"HH24:MI')
                      from p where p.data = (select max(data) from p))
  ),
  'sup', (select coalesce(json_agg(json_build_array(codsupervisor, nome) order by codsupervisor), '[]') from sup),
  'rca', (select coalesce(json_agg(json_build_array(codusur, nome) order by codusur), '[]') from rca),
  'grupos', (select coalesce(json_agg(json_build_array(codsupervisor, grupo) order by codsupervisor), '[]') from relatorio146.grupo_supervisor),
  'fil', (select coalesce(json_agg(json_build_array(codfilial::int, uf, cidade, fantasia) order by codfilial::int), '[]')
            from relatorio146.filial where codfilial ~ '^\d{1,6}$'),
  'r', json_build_object(
     'n', (select count(*) from o),
     'd', (select coalesce(json_agg(data - date '2025-01-01' order by rn), '[]') from o),
     'u', (select coalesce(json_agg(uf order by rn), '[]') from o),
     's', (select coalesce(json_agg(codsupervisor order by rn), '[]') from o),
     'c', (select coalesce(json_agg(codusur order by rn), '[]') from o),
     'f', (select coalesce(json_agg(codfilial::int order by rn), '[]') from o),
     'q', (select coalesce(json_agg(q order by rn), '[]') from o),
     'v', (select coalesce(json_agg(trim_scale(round(v, 6)) order by rn), '[]') from o),
     'l', (select coalesce(json_agg(trim_scale(round(l, 6)) order by rn), '[]') from o)
  )
);
$$;
comment on function relatorio146.montar_pacote(date, date) is
  'Pacote do painel Relatório 146 para um intervalo de datas de pedido (p_ate nulo = sem fim), no grão do Power BI, em colunas, com a lista de filiais (fil: código, UF, cidade, fantasia).';
revoke all on function relatorio146.montar_pacote(date, date) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function relatorio146.montar_pacote(date, date) from anon, authenticated;
  end if;
end $$;
