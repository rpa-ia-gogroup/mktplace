"""T-0118 — `total_shipments` do Mercado Livre na fato diaria.

POR QUE
-------
O "nao entregue" do ML na aba Qualidade dividia `pedidos pagos - entregues` por
pedidos pagos. A gold (`gold.ml_gestao_diaria`) divide por ENVIOS:
`GREATEST(total_shipments - delivered_shipments, 0) / total_shipments`. Pedido
e envio sao populacoes diferentes (pack/carrinho junta pedidos num envio), e o
numero da Torre saia ~5x maior (out/26: 3,01% x ~0,6%).

`delivered_orders` da fato ja vem de `delivered_shipments`; faltava o
denominador. Esta migration so' cria a coluna.

O QUE MUDA
----------
`marts.fact_marketplace_daily_performance.total_shipments` bigint NULL, sem
default, com CHECK de nao negativo. NULL = sem dado (outros canais, ou dia do
ML ainda nao recarregado/backfill); zero so' quando a fonte disse zero.

APLICACAO
---------
Operacao manual no Neon (`alembic upgrade 047`), ANTES do deploy da API e do
novo pin do wheel no Airflow: o upsert do ML e a consulta de `get_quality`
passam a citar a coluna. Reversivel por `alembic downgrade 046`.
"""
from alembic import op

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None

TABELA = "marts.fact_marketplace_daily_performance"
CHECK = "ck_fmdp_total_shipments_nao_negativo"


def upgrade() -> None:
    op.execute(f"ALTER TABLE {TABELA} ADD COLUMN IF NOT EXISTS total_shipments BIGINT NULL")
    op.execute(
        f"ALTER TABLE {TABELA} ADD CONSTRAINT {CHECK} "
        "CHECK (total_shipments IS NULL OR total_shipments >= 0)"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {TABELA} DROP CONSTRAINT IF EXISTS {CHECK}")
    op.execute(f"ALTER TABLE {TABELA} DROP COLUMN IF EXISTS total_shipments")
