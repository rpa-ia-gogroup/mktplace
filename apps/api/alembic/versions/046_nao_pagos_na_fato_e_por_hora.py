"""VENDAS-REALIZADAS — colunas paralelas de pedidos NAO PAGOS (fato diaria e por hora).

POR QUE
-------
A Torre passou a contar vendas so' com pedido PAGO (Shopee sem cancelled/unpaid,
TikTok sem UNPAID/CANCELLED/ON_HOLD, ML so' tem pagos). A Gerencial vai oferecer a
base "Realizados" = pagos + NAO PAGOS (cancelados seguem fora). Em vez de mexer
nas colunas de pagos (`orders`, `gmv`, `canceled_orders`...), os nao pagos
ganham colunas PARALELAS.

O QUE MUDA
----------
Somente ADD COLUMN, nullable e sem default, em duas tabelas:

* `marts.fact_marketplace_daily_performance`: `unpaid_orders` integer,
  `unpaid_gmv` numeric(14,2);
* `marts.fact_marketplace_hourly_sales`: as mesmas duas colunas.

NULL = canal sem fonte de nao pago (ML) ou dia ainda nao recalculado. Zero so'
quando a fonte provou zero. Nenhuma linha, indice ou CHECK e' tocado: antes da
carga das colunas, tudo continua como estava.

DOWNGRADE
---------
Remove as quatro colunas (o dado e' derivado do Data Mart e se recompoe).

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 046`), ANTES do deploy da
API e do novo pin do wheel no Airflow. Nunca pelo Airflow. Reversivel por
`alembic downgrade 045`.
"""
from alembic import op

revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None

TABELAS = (
    "marts.fact_marketplace_daily_performance",
    "marts.fact_marketplace_hourly_sales",
)


def upgrade() -> None:
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} ADD COLUMN unpaid_orders integer NULL, "
                   f"ADD COLUMN unpaid_gmv numeric(14, 2) NULL")


def downgrade() -> None:
    for tabela in TABELAS:
        op.execute(f"ALTER TABLE {tabela} DROP COLUMN unpaid_orders, DROP COLUMN unpaid_gmv")
