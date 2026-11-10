"""Marcas menores via Bling v3 — guarda o token OAuth2 rotativo.

POR QUE
-------
O refresh_token do Bling ROTACIONA a cada uso: cada troca devolve um novo e
invalida o anterior. Variavel de ambiente nao serve (o Render nao a reescreve),
entao o token vivo fica numa tabela do banco de serving. A variavel
BLING_REFRESH_TOKEN_INICIAL so' semeia a tabela quando ela esta vazia.

O QUE MUDA
----------
Uma tabela nova, `audit.bling_oauth_token`, uma linha por conta Bling (hoje
`rituaria`; a Denavita, em outra conta, entra depois com outra chave). A troca
le a linha com `SELECT ... FOR UPDATE`, entao duas trocas simultaneas nunca
acontecem. Nenhuma tabela existente e' tocada.

DOWNGRADE
---------
Remove a tabela; o token vivo se perde e e' preciso reautorizar o app.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 042`). Nunca pelo Airflow.
"""
from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS audit.bling_oauth_token (
        conta              TEXT PRIMARY KEY,
        refresh_token      TEXT NOT NULL,
        access_token       TEXT NULL,
        access_expires_at  TIMESTAMPTZ NULL,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    COMMENT ON TABLE audit.bling_oauth_token IS
    'Token OAuth2 do Bling v3 por conta. O refresh_token rotaciona a cada uso: '
    'gravar o novo a cada troca, sob SELECT FOR UPDATE. Segredo: nunca logar.'
    """,
]

DOWNGRADE_SQL = ["DROP TABLE IF EXISTS audit.bling_oauth_token"]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
