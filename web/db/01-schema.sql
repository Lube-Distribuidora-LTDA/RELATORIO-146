-- =============================================================================
-- RELATÓRIO 146 — schema `relatorio146` no DATA WAREHOUSE (migração relatorio146_01_schema)
-- 2026-10-27. Recriação do Power BI "Relatório 146" (workspace RELATÓRIO 146, página
-- FATURAMENTO 146) no padrão da Lube, com o AGENTE LUBE mantendo os dados ao vivo.
--
-- Onde o dado nasce: o AGENTE LUBE (Desktop\BI\22. AGENTE LUBE, fluxos/relatorio146.toml)
-- lê no WinThor UM PEDIDO POR LINHA (PCPEDC + soma dos itens da PCPEDI), com a mesma regra
-- da Consulta4 do Power BI, e grava em relatorio146.pedido só o que mudou:
--   · relatorio146.pedido      ontem e hoje, de 30 em 30 s;
--   · relatorio146.pedido_60d  os últimos 60 dias, de 10 em 10 min (faturamento e
--     cancelamento atrasados: em 60 dias medidos, nenhum pedido mudou mais de 32 dias depois).
-- O histórico desde 01/01/2025 entrou uma vez (conferencia\carga_historico.py), para as
-- comparações com o ano anterior; o Power BI só tinha 2026.
--
-- Provado em 2026-10-27 09:20 (conferencia\conferir_power_bi.py, só leitura): os pedidos
-- somados no grão do Power BI (dia × UF do cliente × supervisor × RCA × filial) são IGUAIS,
-- linha por linha, ao SQL original (21.385 linhas: pedidos, venda, lucro, positivação, itens).
--
-- O painel não lê esta tabela ao abrir: lê três PACOTES prontos (relatorio146.pacote), que o
-- agente remonta depois de gravar (agente.sistema.apos_gravar → relatorio146.atualizar_painel()):
--   · hoje     ontem e hoje                         (muda de segundos em segundos)
--   · recente  de 60 dias atrás até anteontem       (muda com o faturamento, ~10 min)
--   · base     de 01/01/2025 até 61 dias atrás      (uma vez por dia)
-- Cada pacote só é refeito se um pedido do intervalo dele mudou (gatilho de instrução em
-- relatorio146.pedido → pacote_estado.sujo_desde) ou se o dia virou.
-- =============================================================================

create schema if not exists relatorio146;
comment on schema relatorio146 is
  'RELATÓRIO 146 (venda diária por pedido: região, equipe, RCA, ticket). Gravado pelo AGENTE LUBE; painel na Vercel.';

-- ----------------------------------------------------------------------------- um pedido por linha
create table if not exists relatorio146.pedido (
  numped        bigint primary key,
  data          date        not null,          -- PCPEDC.DATA (data do PEDIDO; o Power BI chamava de "data faturamento")
  hora          smallint,                      -- PCPEDC.HORA / MINUTO (hora da digitação)
  minuto        smallint,
  codfilial     text        not null,
  uf            text,                          -- UF da cidade do CLIENTE na hora da leitura
  codsupervisor integer,                       -- supervisor gravado no pedido
  supervisor    text,                          -- NVL(PCSUPERV.NOME, '* NAO VINCULADO *')
  codusur       integer     not null,
  rca           text,
  codcli        bigint,
  condvenda     integer,
  posicao       text,                          -- L, M, B, P, F (C sem data de cancelamento)
  venda         numeric,                       -- 0 se CONDVENDA 5, 6, 11, 12; senão VLATEND − VLOUTRASDESP − VLFRETE − ST dos itens não bonificados
  custo_liq     numeric,                       -- Σ(VLCUSTOFIN × QT) − Σ(ST × QT) de todos os itens; nulo se o pedido não tem item
  qtitens       numeric,                       -- QTITENS do Power BI
  atualizado_em timestamptz not null default now()
);
create index if not exists ix_pedido_data on relatorio146.pedido (data);
alter table relatorio146.pedido enable row level security;
comment on table relatorio146.pedido is
  'Pedidos de venda do Relatório 146 (filiais 1, 7, 10, 11, 12; posições L, M, B, P, F, C sem cancelamento; CONDVENDA fora de 4, 8, 10, 13, 20, 98, 99), desde 01/01/2025. Gravado pelo AGENTE LUBE.';

-- ----------------------------------------------------------------------------- regiões dos cartões, por CÓDIGO
-- No Power BI eram listas de NOMES dentro de cada cartão: supervisor renomeado ou novo sumia
-- dos cartões regionais sem aviso. Aqui é por código, e o que não tem grupo aparece na tela
-- como "fora das regionais" (nada some em silêncio).
create table if not exists relatorio146.grupo_supervisor (
  codsupervisor integer primary key,
  grupo         text not null check (grupo in ('ES', 'BA', 'RJ', 'INTERNA', 'OUTROS')),
  observacao    text
);
alter table relatorio146.grupo_supervisor enable row level security;
insert into relatorio146.grupo_supervisor (codsupervisor, grupo, observacao) values
  (1, 'ES', 'ES - CENTRAL SUL'), (4, 'ES', 'ES - NORTE'), (6, 'ES', 'ES - GRANDES CONTAS'), (7, 'ES', 'ES - VITORIA NORTE'),
  (8, 'ES', 'ES - TELEVENDAS'), (12, 'ES', 'ES - VITORIA SUL'), (13, 'ES', 'ES - NOROESTE'), (16, 'ES', 'ES - NORDESTE'),
  (17, 'ES', 'ES - LITORAL SUL'),
  (30, 'BA', 'BA - EXTREMO SUL'), (31, 'BA', 'BA - SUL'), (32, 'BA', 'BA - SUDOESTE'), (33, 'BA', 'BA - RECONCAVO'),
  (34, 'BA', 'BA - METROPOLITANA'),
  (21, 'RJ', 'RJ - NORTE E NOROESTE'), (22, 'RJ', 'RJ - REGIÃO DOS LAGOS'), (23, 'RJ', 'RJ - SERRANA'),
  (3, 'INTERNA', 'LUBE DISTRIBUIDORA (operação interna)'),
  (14, 'OUTROS', 'ES - FARMA: fora dos cartões regionais, como no Power BI'),
  (24, 'OUTROS', 'RJ - FARMA: fora dos cartões regionais, como no Power BI'),
  (100, 'OUTROS', 'INATIVO: fora dos cartões regionais, como no Power BI')
on conflict (codsupervisor) do nothing;
comment on table relatorio146.grupo_supervisor is
  'Em que cartão regional entra a venda de cada supervisor (ES, BA, RJ, operação interna). Mesmas listas do Power BI, agora por código. Supervisor sem linha aqui aparece como "fora das regionais".';

-- ----------------------------------------------------------------------------- pacotes do painel
create table if not exists relatorio146.pacote (
  nome        text primary key check (nome in ('base', 'recente', 'hoje')),
  desde       date not null,
  ate         date,                              -- nulo = sem fim (o pacote de hoje)
  versao      text not null,
  gerado_em   timestamptz not null default now(),
  linhas      integer,
  bytes_json  integer,
  ms          integer,
  payload     text not null
);
alter table relatorio146.pacote enable row level security;
comment on table relatorio146.pacote is
  'Pacotes prontos do painel (JSON em texto; a API comprime ao entregar). O navegador junta os três pelo intervalo de datas de cada um.';

create table if not exists relatorio146.pacote_estado (
  id            smallint primary key default 1 check (id = 1),
  sujo_desde    date,                            -- menor data de pedido que mudou desde a última montagem
  atualizado_em timestamptz not null default now()
);
alter table relatorio146.pacote_estado enable row level security;
insert into relatorio146.pacote_estado (id, sujo_desde) values (1, date '2025-01-01') on conflict (id) do nothing;

-- Gatilho de INSTRUÇÃO (não de linha): um por gravação do agente, com a menor data tocada.
create or replace function relatorio146.marcar_mudanca()
returns trigger
language plpgsql
set search_path = relatorio146, pg_temp
as $$
declare
  m date;
begin
  if tg_op = 'INSERT' then
    select min(data) into m from novas;
  elsif tg_op = 'DELETE' then
    select min(data) into m from velhas;
  else
    select least((select min(data) from novas), (select min(data) from velhas)) into m;
  end if;
  if m is not null then
    update relatorio146.pacote_estado
       set sujo_desde = least(coalesce(sujo_desde, m), m), atualizado_em = now()
     where id = 1;
  end if;
  return null;
end;
$$;

drop trigger if exists tg_pedido_ins on relatorio146.pedido;
drop trigger if exists tg_pedido_upd on relatorio146.pedido;
drop trigger if exists tg_pedido_del on relatorio146.pedido;
create trigger tg_pedido_ins after insert on relatorio146.pedido
  referencing new table as novas for each statement execute function relatorio146.marcar_mudanca();
create trigger tg_pedido_upd after update on relatorio146.pedido
  referencing new table as novas old table as velhas for each statement execute function relatorio146.marcar_mudanca();
create trigger tg_pedido_del after delete on relatorio146.pedido
  referencing old table as velhas for each statement execute function relatorio146.marcar_mudanca();

-- ----------------------------------------------------------------------------- o pacote de um intervalo
-- No grão do Power BI: dia × UF do cliente × supervisor × RCA × filial, em colunas.
--   d = dias desde meta.base (2025-01-01) · u = UF · s = cód. supervisor · c = cód. RCA · f = filial
--   q = pedidos · v = venda · l = lucro (nulo quando nenhum pedido da linha tem item, igual ao VLLUCRO original)
-- UF, supervisor e RCA com o cadastro ATUAL (core.dim_*), como o Power BI faz a cada atualização;
-- sem cadastro, o que o pedido trouxe na leitura. Valores cheios: arredondar só na tela.
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
  'Pacote do painel Relatório 146 para um intervalo de datas de pedido (p_ate nulo = sem fim), no grão do Power BI, em colunas.';

create or replace function relatorio146._gravar_pacote(p_nome text, p_desde date, p_ate date)
returns void
language plpgsql
set search_path = relatorio146, pg_temp
as $$
declare
  v_ini  timestamptz := clock_timestamp();
  v_json text;
begin
  v_json := relatorio146.montar_pacote(p_desde, p_ate)::text;
  insert into relatorio146.pacote (nome, desde, ate, versao, gerado_em, linhas, bytes_json, ms, payload)
  values (p_nome, p_desde, p_ate,
          to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYYMMDD-HH24MISS-MS'), now(),
          (v_json::json -> 'r' ->> 'n')::int, octet_length(v_json),
          (extract(epoch from (clock_timestamp() - v_ini)) * 1000)::int, v_json)
  on conflict (nome) do update set desde = excluded.desde, ate = excluded.ate, versao = excluded.versao,
         gerado_em = excluded.gerado_em, linhas = excluded.linhas, bytes_json = excluded.bytes_json,
         ms = excluded.ms, payload = excluded.payload;
end;
$$;

-- Quem chama: o AGENTE LUBE depois de gravar (agente.sistema.apos_gravar) e o botão Atualizar.
-- Refaz só o pacote cujo intervalo teve pedido mudado (e os mais novos que ele) ou cujo
-- intervalo andou com a virada do dia. "Hoje" é o de Brasília: o banco roda em UTC.
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
  return case when cardinality(v_feito) = 0 then 'nada mudou' else array_to_string(v_feito, ', ') end;
end;
$$;
comment on function relatorio146.atualizar_painel() is
  'Remonta os pacotes do painel Relatório 146 que mudaram. Quem chama: o AGENTE LUBE depois de gravar no schema relatorio146 (agente.sistema.apos_gravar).';

-- ----------------------------------------------------------------------------- acesso: só o servidor
revoke all on all tables in schema relatorio146 from public;
revoke all on function relatorio146.montar_pacote(date, date) from public;
revoke all on function relatorio146._gravar_pacote(text, date, date) from public;
revoke all on function relatorio146.atualizar_painel() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema relatorio146 from anon, authenticated;
    revoke all on all tables in schema relatorio146 from anon, authenticated;
    revoke all on function relatorio146.montar_pacote(date, date) from anon, authenticated;
    revoke all on function relatorio146._gravar_pacote(text, date, date) from anon, authenticated;
    revoke all on function relatorio146.atualizar_painel() from anon, authenticated;
  end if;
end $$;

-- ----------------------------------------------------------------------------- o agente monta depois de gravar
insert into agente.sistema (sistema, versao, apos_gravar, apos_gravar_s)
values ('relatorio146', '', 'select relatorio146.atualizar_painel()', 15)
on conflict (sistema) do update set apos_gravar = excluded.apos_gravar, apos_gravar_s = excluded.apos_gravar_s;
