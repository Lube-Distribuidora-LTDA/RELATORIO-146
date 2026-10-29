-- =============================================================================
-- RELATÓRIO 146 — itens dos pedidos (migração relatorio146_03_itens), 2026-10-29
--
-- Pedido do Júlio: clicar no pedido abre uma tela lateral com tudo o que tem nele. Os itens
-- (PCPEDI) chegam pelo AGENTE LUBE, como os pedidos (fluxos/relatorio146.toml): o fluxo
-- relatorio146.item relê os itens dos últimos 15 dias de 30 em 30 s (o corte acontece no
-- faturamento, 98,6% em até 7 dias). A tabela guarda 62 dias (sempre cobre o mês atual e o
-- anterior): ~8,5 itens por pedido, 190 mil em 60 dias (28 MB); desde 2025 seriam 1,74 milhão.
-- A primeira carga dos 62 dias foi o conferencia/carga_itens.py (que também reconcilia).
-- relatorio146.atualizar_painel() apaga o que passou dos 62 dias.
--
-- Os valores ficam como o WinThor grava (por unidade); a tela calcula:
--   valor do item = QT × PVENDA − QT × ST (bonificado: 0, como na venda do pedido)
--   custo do item = QT × VLCUSTOFIN − QT × ST
-- Nome e embalagem do produto vêm de inventario.produto (o agente mantém; sem ele, o nome de
-- core.dim_produto); a foto, de trade.produto_miniatura.
-- =============================================================================

create table if not exists relatorio146.item (
  numped      bigint   not null,
  numseq      integer  not null,
  data        date     not null,          -- data do PEDIDO (a janela do agente é por ela)
  codprod     integer  not null,
  qt          numeric,                    -- quantidade atendida
  qtorig      numeric,                    -- quantidade pedida (antes do corte)
  pvenda      numeric,                    -- preço unitário de venda (com ST)
  ptabela     numeric,                    -- preço de tabela
  st          numeric,                    -- ST por unidade
  vlcustofin  numeric,                    -- custo financeiro por unidade
  bonific     text,                       -- N = vendido; outro valor = bonificado
  posicao     text,
  atualizado_em timestamptz not null default now(),
  primary key (numped, numseq)
);
create index if not exists ix_item_data on relatorio146.item (data);
alter table relatorio146.item enable row level security;
revoke all on relatorio146.item from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on relatorio146.item from anon, authenticated;
  end if;
end $$;
comment on table relatorio146.item is
  'Itens (PCPEDI) dos pedidos do Relatório 146 dos últimos 62 dias. Gravado pelo AGENTE LUBE; o que passa de 62 dias sai em relatorio146.atualizar_painel().';

-- O pedido com os itens, para a tela lateral. Itens só existem para os últimos 62 dias.
create or replace function relatorio146.pedido_detalhe(p_numped bigint)
returns json
language sql
stable
set search_path = relatorio146, pg_temp
as $$
select json_build_object(
  'itens_desde', to_char((now() at time zone 'America/Sao_Paulo')::date - 62, 'YYYY-MM-DD'),
  'pedido', (
    select json_build_object(
      'numped', pe.numped, 'data', to_char(pe.data, 'YYYY-MM-DD'), 'hora', pe.hora, 'minuto', pe.minuto,
      'codfilial', pe.codfilial, 'uf', coalesce(dc.uf, pe.uf), 'codcli', pe.codcli, 'cliente', dc.cliente, 'cidade', dc.cidade,
      'codusur', pe.codusur, 'rca', coalesce(dr.nome, pe.rca), 'codsupervisor', pe.codsupervisor,
      'supervisor', coalesce(ds.nome, pe.supervisor), 'posicao', pe.posicao, 'condvenda', pe.condvenda,
      'venda', pe.venda, 'lucro', case when pe.custo_liq is null then null else coalesce(pe.venda, 0) - pe.custo_liq end,
      'qtitens', pe.qtitens, 'atualizado_em', pe.atualizado_em)
      from relatorio146.pedido pe
      left join core.dim_cliente dc on dc.codcli = pe.codcli
      left join core.dim_rca dr on dr.codusur = pe.codusur
      left join core.dim_supervisor ds on ds.codsupervisor = pe.codsupervisor
     where pe.numped = p_numped),
  'itens', (
    select coalesce(json_agg(json_build_object(
             'numseq', i.numseq, 'codprod', i.codprod, 'descricao', coalesce(pr.descricao, dp.descricao), 'embalagem', pr.embalagem,
             'unidade', pr.unidade, 'fornecedor', pr.fornecedor, 'qt', i.qt, 'qtorig', i.qtorig, 'pvenda', i.pvenda,
             'ptabela', i.ptabela, 'st', i.st, 'vlcustofin', i.vlcustofin, 'bonific', i.bonific, 'posicao', i.posicao,
             'foto', exists (select 1 from trade.produto_miniatura m where m.codprod = i.codprod))
           order by i.numseq), '[]')
      from relatorio146.item i
      left join inventario.produto pr on pr.codprod = i.codprod
      left join core.dim_produto dp on dp.codprod = i.codprod
     where i.numped = p_numped)
);
$$;
revoke all on function relatorio146.pedido_detalhe(bigint) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function relatorio146.pedido_detalhe(bigint) from anon, authenticated;
  end if;
end $$;
comment on function relatorio146.pedido_detalhe(bigint) is
  'Um pedido do Relatório 146 com os itens (últimos 62 dias), nome do produto e se tem foto. Usada pela API /api/pedido.';

-- atualizar_painel(): além dos pacotes, tira os itens que passaram dos 62 dias (o agente só
-- mexe nos 15 dias da janela dele).
create or replace function relatorio146.atualizar_painel()
returns text
language plpgsql
set search_path = relatorio146, pg_temp
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_sujo date;
  v_feito text[] := '{}';
  r record;
begin
  with x as (select sujo_desde from relatorio146.pacote_estado where id = 1 for update)
  update relatorio146.pacote_estado e set sujo_desde = null, atualizado_em = now()
    from x where e.id = 1
  returning x.sujo_desde into v_sujo;

  for r in
    select * from (values ('base', date '2025-01-01', v_hoje - 61),
                          ('recente', v_hoje - 60, v_hoje - 2),
                          ('hoje', v_hoje - 1, null::date)) t(nome, desde, ate)
  loop
    if not exists (select 1 from relatorio146.pacote p
                    where p.nome = r.nome and p.desde = r.desde and p.ate is not distinct from r.ate)
       or (v_sujo is not null and (r.ate is null or v_sujo <= r.ate)) then
      perform relatorio146._gravar_pacote(r.nome, r.desde, r.ate);
      v_feito := v_feito || r.nome;
    end if;
  end loop;

  delete from relatorio146.item where data < v_hoje - 62;
  return case when cardinality(v_feito) = 0 then 'nada mudou' else array_to_string(v_feito, ', ') end;
end;
$$;
revoke all on function relatorio146.atualizar_painel() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function relatorio146.atualizar_painel() from anon, authenticated;
  end if;
end $$;
