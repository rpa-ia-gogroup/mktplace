"""Shadow Shopee via API: o CHECK de marca passa a aceitar a kokeshi.

POR QUE
-------
A 027 fechou `marts.fact_shopee_daily_api_shadow.brand` nas 4 contas que tinham app
Shopee. O app da Kokeshi foi aprovado (Seller In House System, Live partner_id 2053229)
e a integracao `kokeshi/shopee` ja' existe no registry do Airflow (ativo=false ate' o
backfill). Sem esta migration, a primeira linha da kokeshi seria recusada pelo CHECK.

O QUE MUDA
----------
So' o `ck_fsdas_brand`: troca a lista de 4 pela de 5. Nenhum dado e' tocado. O default
do CLI (`CONTAS_API`) continua com 4; a kokeshi entra nele depois do backfill dela.

DOWNGRADE
---------
Volta a lista de 4. Se ja' houver linha da kokeshi, o ADD CONSTRAINT falha (de proposito:
apagar dado e' decisao humana; `DELETE ... WHERE brand = 'kokeshi'` antes, se for o caso).

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 044`). Nunca pelo Airflow.
"""
from alembic import op

revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None

TABELA = "marts.fact_shopee_daily_api_shadow"

#: Lista FECHADA, escrita LITERALMENTE no DDL; um teste confere que e' a do publisher.
MARCAS = ("apice", "barbours", "kokeshi", "lescent", "rituaria")

UPGRADE_SQL = [
    f"ALTER TABLE {TABELA} DROP CONSTRAINT ck_fsdas_brand",
    f"""ALTER TABLE {TABELA} ADD CONSTRAINT ck_fsdas_brand
        CHECK (brand IN ('apice', 'barbours', 'kokeshi', 'lescent', 'rituaria'))""",
]

DOWNGRADE_SQL = [
    f"ALTER TABLE {TABELA} DROP CONSTRAINT ck_fsdas_brand",
    f"""ALTER TABLE {TABELA} ADD CONSTRAINT ck_fsdas_brand
        CHECK (brand IN ('apice', 'barbours', 'lescent', 'rituaria'))""",
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
