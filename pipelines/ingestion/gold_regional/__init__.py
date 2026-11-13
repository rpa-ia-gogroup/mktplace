"""
Gate 6A — aplicação da Gold regional (`gold.fct_marketplace_region_daily`) no
Data Mart primary.

Nada neste pacote escreve em banco a menos que `write_conn.load_write_secret`
tenha validado `.env.gold-write.local` (fora do repositório, nunca lido por
outro módulo) e o preflight de `write_conn.run_preflight` tenha passado.

T-0109c — nome da tabela. O rename em massa da gold (airflow #1939) renomeou a
TABELA para `gold.fct_marketplace_region_daily` e deixou, no nome antigo
`gold.marketplace_region_daily`, uma VIEW de compatibilidade que vai para o
archive na limpeza de 30 dias. Toda leitura/escrita deste pacote e de
`pipelines.sync_region_daily` usa as constantes abaixo, nunca o nome literal.
O rename NÃO levou a sequence, os índices nem as constraints: a sequence do
`id` continua `gold.marketplace_region_daily_id_seq` (relkind `S`, provado no
catálogo em 13/11), e `marketplace_region_daily_pkey`, `uq_region_daily` e
`ix_region_daily_*` mantêm o nome. Por isso a sequence tem constante própria,
NÃO derivada do nome da tabela.
"""

GOLD_REGION_SCHEMA = "gold"
GOLD_REGION_TABLE_NAME = "fct_marketplace_region_daily"
GOLD_REGION_TABLE = f"{GOLD_REGION_SCHEMA}.{GOLD_REGION_TABLE_NAME}"

GOLD_REGION_ID_SEQUENCE_NAME = "marketplace_region_daily_id_seq"
GOLD_REGION_ID_SEQUENCE = f"{GOLD_REGION_SCHEMA}.{GOLD_REGION_ID_SEQUENCE_NAME}"
