"""T-0068 — acrescenta buyer_shipping_fee a marts.fact_tiktok_order_discounts_daily.

POR QUE
-------
A receita TikTok da DRE e' o GMV do mart (`total_amount`, que contem o frete
pago pelo comprador), e o frete da DRE e' o `shipping_cost_amount` do repasse,
que ja' vem LIQUIDO desse frete: a margem contava o frete do comprador duas
vezes. A DRE passa a subtrair o frete do comprador da receita (decisao de
06/11/2026, D6 opcao a; contrato `docs/dre_contrato_0.md` §4.1.1), e nenhuma
tabela do Neon tinha esse valor.

O QUE MUDA
----------
SOMENTE uma coluna ANULAVEL e um CHECK. Nenhuma linha, indice ou outro CHECK
e' tocado. As linhas existentes ficam com NULL ate' o sync recarrega-las: NULL
e' ausencia, e a DRE mantem a receita antiga, com motivo, enquanto houver dia
com GMV sem o valor.

    buyer_shipping_fee = SUM(shipping_fee) dos pedidos da populacao comercial,
                         com a mesma dedup do official_gmv (ver o sync).

NUMERIC(14, 2): o `shipping_fee` da Raw e' valor monetario em centavos, e a
precisao explicita ja' recusa `Infinity`. O CHECK trata `NaN` porque
`'NaN'::numeric >= 0` e' TRUE no Postgres (mesma razao dos anti-NaN da 013).

ORDEM DE DEPLOY
---------------
O sync detecta a coluna (`pg_attribute`) e so' a inclui no INSERT quando ela
existe. Codigo antes da migration: lote identico ao de hoje. Migration antes
do codigo: a coluna fica NULL. As duas ordens sao seguras.

GRANTS
------
Nenhum: `ADD COLUMN` herda os privilegios de tabela ja' concedidos (013 nao
concede por coluna).

DOWNGRADE
---------
Remove o CHECK e a coluna. Os valores do frete do comprador se perdem; o
restante da tabela fica intacto.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 041`). Nunca pelo
Airflow.
"""
from alembic import op

revision = "041"
# A 040 (`040_dre_insumo_impostos_webgex.py`, PR #233) ainda nao esta' na main;
# esta branch sera' rebaseada sobre ela depois do merge.
down_revision = "040"
branch_labels = None
depends_on = None

TABELA = "marts.fact_tiktok_order_discounts_daily"

UPGRADE_SQL = [
    f"""
    ALTER TABLE {TABELA}
        ADD COLUMN buyer_shipping_fee NUMERIC(14, 2) NULL,
        ADD CONSTRAINT ck_ftodd_bsf_nao_negativo_nao_nan CHECK (
            buyer_shipping_fee IS NULL
            OR (buyer_shipping_fee >= 0 AND buyer_shipping_fee <> 'NaN')
        )
    """,
    f"""
    COMMENT ON COLUMN {TABELA}.buyer_shipping_fee IS
    'SUM(shipping_fee) da populacao comercial, mesma dedup de official_gmv: '
    'frete pago pelo comprador, parte de total_amount. NULL = ausente (pedido '
    'comercial sem shipping_fee, ou linha publicada antes da 041), nunca zero. '
    'A DRE subtrai do GMV TikTok na receita (T-0068).'
    """,
]

DOWNGRADE_SQL = [
    f"ALTER TABLE {TABELA} DROP CONSTRAINT ck_ftodd_bsf_nao_negativo_nao_nan",
    f"ALTER TABLE {TABELA} DROP COLUMN buyer_shipping_fee",
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
