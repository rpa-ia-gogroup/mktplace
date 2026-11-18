"""TikTok Shop (app proprio da Torre) — guarda os tokens OAuth por marca.

POR QUE
-------
O app da Torre no TikTok Shop (`TIKTOK_APP_KEY`) autoriza cada loja e devolve
access_token (vale ~7 dias) e refresh_token. A renovacao devolve um refresh novo,
entao o token vivo fica numa tabela do banco de serving, como o do Bling (042).

O QUE MUDA
----------
Uma tabela nova, `audit.tiktok_oauth_token`, uma linha por marca (barbours,
gocase, lescent, kokeshi, rituaria, apice). A renovacao le a linha com
`SELECT ... FOR UPDATE`: duas renovacoes simultaneas nunca acontecem. Nenhuma
tabela existente e' tocada.

DOWNGRADE
---------
Remove a tabela; os tokens se perdem e cada loja precisa reautorizar o app.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 050`). Nunca pelo Airflow.
"""
from alembic import op

revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS audit.tiktok_oauth_token (
        conta               TEXT PRIMARY KEY,
        access_token        TEXT NOT NULL,
        access_expires_at   TIMESTAMPTZ NOT NULL,
        refresh_token       TEXT NOT NULL,
        refresh_expires_at  TIMESTAMPTZ NULL,
        open_id             TEXT NULL,
        seller_name         TEXT NULL,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    COMMENT ON TABLE audit.tiktok_oauth_token IS
    'Tokens OAuth do app da Torre no TikTok Shop, por marca. Renovar sob SELECT FOR UPDATE '
    'e gravar o refresh novo a cada troca. Segredo: nunca logar.'
    """,
]

DOWNGRADE_SQL = ["DROP TABLE IF EXISTS audit.tiktok_oauth_token"]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
