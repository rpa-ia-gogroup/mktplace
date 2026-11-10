"""Marcas menores via Bling v3 — cache persistente da lista de pedidos e dos itens.

POR QUE
-------
Ao filtrar uma marca menor a tela ficava 30 a 40 s em "Carregando", porque cada consulta
lia a lista de pedidos das 6 lojas (e, nos produtos, o detalhe de cada pedido) direto do
Bling, a ~3 requisicoes por segundo. Um cache so' em memoria se perde a cada deploy ou
reinicio do Render. Estas tabelas guardam o que o Bling ja' entregou; uma rotina em
segundo plano as mantem aquecidas e a tela so' le o banco.

O QUE MUDA
----------
Tres tabelas novas no schema `audit` (nenhuma existente e' tocada):
  - `bling_pedido`        a lista (id, loja, data, total, situacao), renovada por janela de data e
                          de alteracao; cancelados ficam guardados (a leitura os exclui);
  - `bling_pedido_itens`  os itens de cada pedido; pedido com detalhe lido nao muda, entao
                          nunca e' relido;
  - `bling_sync`          chave/valor com a ultima sincronizacao de cada loja e o id da
                          situacao "Cancelado".

DOWNGRADE
---------
Remove as tres tabelas; o cache e' reconstruido pela rotina (a custa de novas leituras).

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 043`). Nunca pelo Airflow.
"""
from alembic import op

revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS audit.bling_pedido (
        id            BIGINT PRIMARY KEY,
        loja_id       BIGINT NOT NULL,
        data          DATE NOT NULL,
        total         NUMERIC(14, 2) NOT NULL,
        situacao_id   BIGINT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_bling_pedido_loja_data ON audit.bling_pedido (loja_id, data)",
    """
    CREATE TABLE IF NOT EXISTS audit.bling_pedido_itens (
        pedido_id BIGINT PRIMARY KEY,
        itens     JSONB NOT NULL,
        lido_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit.bling_sync (
        chave         TEXT PRIMARY KEY,
        valor         TEXT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    COMMENT ON TABLE audit.bling_pedido IS
    'Cache da lista de pedidos de venda do Bling (marcas menores). Cancelados ficam; a leitura os exclui.'
    """,
]

DOWNGRADE_SQL = [
    "DROP TABLE IF EXISTS audit.bling_sync",
    "DROP TABLE IF EXISTS audit.bling_pedido_itens",
    "DROP TABLE IF EXISTS audit.bling_pedido",
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
