"""Bling — itens em cache por conta: a chave de `audit.bling_pedido_itens` passa a ser (conta, pedido_id).

POR QUE
-------
O cache de itens (migration 043) tem `pedido_id` como chave unica. Desde que a Denavita passou a ter o
Bling DELA (conta 'denavita'), o id de um pedido so' vale dentro da conta que o emitiu: dois pedidos de
contas diferentes poderiam ter o mesmo id e um sobrescreveria (ou ocultaria) o outro. Sem o cache no banco,
os itens da Denavita ficavam so' na memoria e cada reinicio do Render recomecava do zero (38 s por carga,
142 de 454 pedidos lidos).

O QUE MUDA
----------
Tabela existente `audit.bling_pedido_itens` (nenhuma outra e' tocada):
  - coluna nova `conta TEXT NOT NULL DEFAULT 'rituaria'` (as linhas que ja' existem sao da Rituaria);
  - a chave primaria passa de (pedido_id) para (conta, pedido_id).
`audit.bling_pedido` (a lista) NAO muda: a lista da Denavita nao vai para o banco.

IDEMPOTENTE
-----------
Pode rodar de novo: a coluna e' `IF NOT EXISTS` e a chave so' e' trocada se ainda nao tiver 2 colunas.

DOWNGRADE
---------
Apaga as linhas das contas que nao sao a Rituaria (o cache delas e' refeito pela rotina), volta a chave
para (pedido_id) e remove a coluna `conta`.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 052`), ANTES de publicar a API que a usa: o codigo novo
le e grava a coluna `conta`. Nunca pelo Airflow.
"""
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    "ALTER TABLE audit.bling_pedido_itens ADD COLUMN IF NOT EXISTS conta TEXT NOT NULL DEFAULT 'rituaria'",
    """
    DO $$
    DECLARE
        pk   TEXT;
        cols INT;
    BEGIN
        SELECT conname, cardinality(conkey) INTO pk, cols
          FROM pg_constraint
         WHERE conrelid = CAST('audit.bling_pedido_itens' AS regclass) AND contype = 'p';
        IF cols IS DISTINCT FROM 2 THEN
            IF pk IS NOT NULL THEN
                EXECUTE 'ALTER TABLE audit.bling_pedido_itens DROP CONSTRAINT ' || quote_ident(pk);
            END IF;
            ALTER TABLE audit.bling_pedido_itens ADD CONSTRAINT bling_pedido_itens_pkey PRIMARY KEY (conta, pedido_id);
        END IF;
    END
    $$
    """,
    """
    COMMENT ON COLUMN audit.bling_pedido_itens.conta IS
    'Conta Bling dona do pedido (rituaria | denavita): o id do pedido so'' vale dentro da conta.'
    """,
]

DOWNGRADE_SQL = [
    "DELETE FROM audit.bling_pedido_itens WHERE conta <> 'rituaria'",
    "ALTER TABLE audit.bling_pedido_itens DROP CONSTRAINT IF EXISTS bling_pedido_itens_pkey",
    "ALTER TABLE audit.bling_pedido_itens ADD CONSTRAINT bling_pedido_itens_pkey PRIMARY KEY (pedido_id)",
    "ALTER TABLE audit.bling_pedido_itens DROP COLUMN IF EXISTS conta",
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
