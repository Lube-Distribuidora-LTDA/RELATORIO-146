# RELATÓRIO 146 — venda por pedido, ao vivo

Recriação do Power BI **"Relatório 146"** (workspace RELATÓRIO 146, página FATURAMENTO 146) no padrão da Lube:
WinThor → **AGENTE LUBE** (de 30 em 30 s) → DATA WAREHOUSE (schema `relatorio146`) → painel na Vercel.

O que a tela responde, como o original: quanto vendemos no período (total, equipes ES, BA e RJ, operação interna),
o ticket médio de cada um, a participação de cada UF do cliente, quanto entrou hoje e na semana, a venda dia a dia do
mês e os RCAs com maior ticket. **Todo número abre os pedidos por trás dele** (tela Pedidos, com Voltar e Excel).

## De onde vem o dado

O agente (`Desktop\BI\22. AGENTE LUBE`, catálogo `fluxos/relatorio146.toml`) lê no WinThor **um pedido por linha**
(PCPEDC + soma dos itens da PCPEDI) com a mesma regra da `Consulta4` do Power BI e grava só o que mudou em
`relatorio146.pedido`:

| Fluxo | Janela | A cada |
|---|---|---|
| `relatorio146.pedido` | ontem e hoje | 30 s |
| `relatorio146.pedido_60d` | 60 dias | 10 min |

O histórico desde 01/01/2025 entrou uma vez (`conferencia/carga_historico.py`, que também reconcilia um período
antigo). Em 60 dias medidos, nenhum pedido mudou mais de 32 dias depois da data dele.

**Venda** = 0 se `CONDVENDA` 5, 6, 11 ou 12; senão `VLATEND − VLOUTRASDESP − VLFRETE − ST dos itens não bonificados`.
**Lucro** = venda − (custo financeiro dos itens − ST de todos os itens). Filiais 1, 7, 10, 11 e 12; posições L, M, B,
P, F e C sem data de cancelamento; `CONDVENDA` fora de 4, 8, 10, 13, 20, 98 e 99. A data é a **do pedido**
(`PCPEDC.DATA`), não a da nota.

## O painel não espera o banco

Depois de gravar, o agente roda `relatorio146.atualizar_painel()`, que remonta só o pacote que mudou:
`base` (01/01/2025 até 61 dias atrás, uma vez por dia), `recente` (60 dias até anteontem) e `hoje` (ontem e hoje).
O navegador guarda cada pacote (IndexedDB), pergunta de 15 em 15 s se algum mudou (`/api/versao`), baixa só ele
(`/api/pacote`) e redesenha sem piscar. O botão **Atualizar** é a ponte do agente (`agente.pedido` + `NOTIFY`): o
agente lê o WinThor na hora e responde em ~2 s.

## Prova (2026-10-27)

- `conferencia/conferir_power_bi.py`: o SQL novo, somado no grão do Power BI, é **igual linha por linha** ao SQL
  original (21.385 linhas: pedidos, venda, lucro, positivação, itens).
- `conferencia/sql_original_agora.py`: o SQL original rodado às 09:52 deu, em 01 a 26/10, **o mesmo valor e a mesma
  quantidade de pedidos da tela**, ao centavo. O Power BI das 08:19 mostrava outro valor: é o WinThor que mudou entre as
  duas leituras, não a regra.
- Tabela de RCAs igual à da documentação técnica.

Os valores de referência do Power BI ficam em `conferencia/referencias-power-bi.json`, **só na máquina** (são valores
de venda; este repositório é público). Os números da conferência estão no cérebro (`Projetos/RELATÓRIO 146.md`).

## O que mudou de propósito em relação ao Power BI

Nenhum número da regra mudou. Correções de tela:
- "hoje" e "semana" no dia de Brasília (o Power BI usava UTC: depois das 21h já era amanhã);
- região sem venda mostra R$ 0 (o original mostrava " BA");
- meses do período em ordem de calendário (o cartão pegava o primeiro em ordem alfabética);
- % por UF sempre sobre o total de todas as UFs (com uma UF marcada, o original passava de 100%);
- ticket e % de lucro com "—" sem pedido (o original mostrava NaN/Infinito);
- regiões dos cartões por **código** de supervisor (`relatorio146.grupo_supervisor`), não por nome; o que não entra em
  nenhum cartão (ES - FARMA, RJ - FARMA, INATIVO, supervisor novo) aparece numa linha "fora dos cartões regionais";
- "DATA FATURAMENTO" virou o período do pedido; "FIFLIAL" virou Filial.

Mantido para bater: cartões regionais por **equipe** (supervisor) e participação por **UF do cliente** (as duas regras
convivem, cada uma com o nome do que conta); ticket conta bonificação e troca como pedido; o gráfico mostra sempre o mês
corrente.

## No ar

**https://relatorio-146.vercel.app** — projeto Vercel `relatorio-146` (Root `web`, Other, `gru1`, Node 22), deploy a cada
push na `main`. **Só abre para quem tem acesso pelo Painel Lube** (guarda da Sentinela 1.3.0, `exige_login`; regra "só na
rede da Lube" em observar, como os outros sistemas internos). O cartão no portal nasceu **inativo**: quem vê é decisão do
Júlio.

Variáveis da Vercel (Production e Preview): `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT` (5432), `SUPABASE_DB_NAME`,
`SUPABASE_DB_USER` e `SUPABASE_DB_PASSWORD` (Sensitive, cadastrada pelo Júlio). Variável nova só vale em deploy novo.

## Rodar na máquina

`INICIAR.bat` (porta 3106). O servidor local usa o `ENV` do agente ou do Inventário que já existe na máquina e só
escuta a própria máquina (aqui não há o login do Painel Lube).

## Arquivos

| Caminho | O que é |
|---|---|
| `web/` | painel (site estático + funções `api/`) |
| `web/db/01-schema.sql` | schema `relatorio146` (migrações `relatorio146_01_schema` e `relatorio146_02_pacote_grupos`) |
| `conferencia/` | scripts só de leitura (conferência contra o Power BI) e a carga do histórico |

Registro no cérebro: `Projetos/RELATÓRIO 146.md`.
