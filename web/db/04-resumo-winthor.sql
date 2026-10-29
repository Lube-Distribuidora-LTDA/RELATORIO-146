-- =============================================================================
-- RELATÓRIO 146 — a tela "Resumo de Vendas" do WinThor (migração relatorio146_04_resumo_winthor),
-- 2026-10-29
--
-- Pedido do Júlio: a aba Pedidos "siga a mesma maneira que as telas do WinThor com as mesmas abas"
-- (rotina 146: Por supervisor → RCA → cliente → pedidos do cliente; Por prazo, Por evolução, Por
-- classe, Por região, Por emitente, Analítico, Por cobrança, Por check out, Origem venda, Por área
-- de atuação, Por fornecedor). Cada coluna foi conferida contra os prints dele (01 a 29/10/2026,
-- conferencia/conferir_winthor_146.py e investigar_*_146.py):
--   Vl.tabela       = PCPEDC.VLTABELA − outras despesas − frete − ST (zero na condição 5, 6, 11, 12)
--   Vl.bonificação  = Σ QT × PBONIFIC dos itens − ST (o ST só na condição 5)
--   Vl.CMV          = custo_liq (já existia);  Vl.CMV real = Σ QT × VLCUSTOREAL − ST
--   Peso            = PCPEDC.TOTPESO;  Qt.itens = linhas da PCPEDI fora da condição 5, 6, 11, 12
--   Média itens     = Σ NUMITENS ÷ pedidos;  Pz.médio = Σ PRAZOMEDIO × venda ÷ Σ venda
--   Mix             = produtos distintos dos pedidos com venda (precisa dos itens: só 62 dias)
--   Meta            = PCMETASUP (supervisor) e PCMETARCA (RCA), Σ VLVENDAPREV dos dias do período
--   Clientes cad.   = clientes com o RCA como RCA 1 ou 2, cadastrados até o fim do período
--   Visitas         = pares cliente × dia com pedido
-- =============================================================================

-- colunas novas do pedido (o agente grava; o histórico entra pelo conferencia/carga_historico.py)
alter table relatorio146.pedido
  add column if not exists vltabela    numeric,
  add column if not exists bonific     numeric,
  add column if not exists custo_real  numeric,
  add column if not exists peso        numeric,
  add column if not exists numitens    integer,
  add column if not exists linhas      integer,
  add column if not exists mix         integer,
  add column if not exists prazo       numeric,
  add column if not exists numcar      bigint,
  add column if not exists codplpag    integer,
  add column if not exists codcob      text,
  add column if not exists codemitente integer,
  add column if not exists origemped   text,
  add column if not exists numregiao   integer,
  add column if not exists numcaixa    integer,
  add column if not exists dtfat       date,
  add column if not exists tipofj      text,
  add column if not exists classevenda text,
  add column if not exists areaatuacao text;

comment on column relatorio146.pedido.vltabela is 'Vl.tabela da 146: VLTABELA − outras despesas − frete − ST dos itens vendidos; zero nas condições 5, 6, 11, 12.';
comment on column relatorio146.pedido.bonific is 'Vl.bonificação da 146: Σ QT × PBONIFIC − ST (o ST só na condição 5).';
comment on column relatorio146.pedido.custo_real is 'Vl.CMV real da 146: Σ QT × VLCUSTOREAL − Σ QT × ST.';
comment on column relatorio146.pedido.linhas is 'Linhas da PCPEDI do pedido (Qt.itens da 146 = linhas fora das condições 5, 6, 11, 12).';
comment on column relatorio146.pedido.mix is 'Produtos distintos do pedido.';
comment on column relatorio146.pedido.prazo is 'PCPEDC.PRAZOMEDIO (o Pz.médio da 146 é ponderado pela venda).';
comment on column relatorio146.pedido.tipofj is 'PCCLIENT.TIPOFJ na leitura (F físico, J jurídico).';
comment on column relatorio146.pedido.areaatuacao is 'PCUSUARI.AREAATUACAO do RCA na leitura (aba Por área de atuação).';

create index if not exists ix_pedido_codcli_data on relatorio146.pedido (codcli, data);
create index if not exists ix_pedido_codusur_data on relatorio146.pedido (codusur, data);

-- cadastros das abas (o agente mantém, inteiros)
create table if not exists relatorio146.plano    (codplpag integer primary key, descricao text, numdias integer);
create table if not exists relatorio146.cobranca (codcob text primary key, cobranca text);
create table if not exists relatorio146.emitente (matricula integer primary key, nome text);
create table if not exists relatorio146.regiao   (numregiao integer primary key, regiao text, uf text);
create table if not exists relatorio146.area     (codigo text primary key, descricao text);

-- carteira: quem é RCA 1 e 2 de cada cliente e quando foi cadastrado (Qt.clientes cad. e Total cadastrado)
create table if not exists relatorio146.cliente (
  codcli integer primary key, codusur1 integer, codusur2 integer, dtcadastro date, dtexclusao date
);
create index if not exists ix_cliente_rca1 on relatorio146.cliente (codusur1);
create index if not exists ix_cliente_rca2 on relatorio146.cliente (codusur2);

-- metas por dia (PCMETARCA e PCMETASUP: VLVENDAPREV)
create table if not exists relatorio146.meta_rca (
  codfilial text not null, codusur integer not null, data date not null, valor numeric,
  primary key (codfilial, codusur, data)
);
create table if not exists relatorio146.meta_sup (
  codfilial text not null, codsupervisor integer not null, data date not null, valor numeric,
  primary key (codfilial, codsupervisor, data)
);
create index if not exists ix_meta_rca_data on relatorio146.meta_rca (data);
create index if not exists ix_meta_sup_data on relatorio146.meta_sup (data);

do $$
declare t text;
begin
  foreach t in array array['plano','cobranca','emitente','regiao','area','cliente','meta_rca','meta_sup'] loop
    execute format('alter table relatorio146.%I enable row level security', t);
    execute format('revoke all on relatorio146.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on relatorio146.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

comment on table relatorio146.cliente is 'Carteira do WinThor (PCCLIENT: RCA 1 e 2, cadastro e exclusão), para Qt.clientes cad. e Total cadastrado da 146. Gravado pelo AGENTE LUBE.';
comment on table relatorio146.meta_rca is 'PCMETARCA: meta de venda (VLVENDAPREV) por filial, RCA e dia. Gravado pelo AGENTE LUBE (62 dias para trás e o futuro; o histórico entrou pelo conferencia/carga_fluxo.py).';
comment on table relatorio146.meta_sup is 'PCMETASUP: meta de venda (VLVENDAPREV) por filial, supervisor e dia. Gravado pelo AGENTE LUBE.';
