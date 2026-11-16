"""CHAVES-PESSOAIS — chaves pessoais (torre_pat_...) do MCP e da API REST da Torre.

POR QUE
-------
Ao lado do login OAuth do MCP (Auth0), quem precisa de acesso sem navegador
(ex.: um simulador) usa uma chave pessoal com dono, prazo e revogacao.

O QUE MUDA
----------
Uma tabela nova, `audit.torre_chave_pessoal`. Guarda SO' o hash SHA-256 da
chave: a chave inteira e' mostrada uma vez, na criacao, e nunca gravada.
`expira_em` e' obrigatorio. Nenhuma tabela existente e' tocada.

DOWNGRADE
---------
Remove a tabela; todas as chaves deixam de valer.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 049`), ANTES do deploy
da API. Nunca pelo Airflow. Reversivel por `alembic downgrade 048`.
"""
from alembic import op

revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS audit.torre_chave_pessoal (
        id             BIGSERIAL PRIMARY KEY,
        nome           TEXT NOT NULL,
        dono_email     TEXT NOT NULL,
        hash_chave     TEXT NOT NULL UNIQUE,
        criada_por     TEXT NOT NULL,
        criada_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
        expira_em      TIMESTAMPTZ NOT NULL,
        revogada_em    TIMESTAMPTZ NULL,
        ultimo_uso_em  TIMESTAMPTZ NULL
    )
    """,
    """
    COMMENT ON TABLE audit.torre_chave_pessoal IS
    'Chaves pessoais da Torre (MCP e API REST). So o hash SHA-256 da chave; '
    'a chave em si nunca e gravada nem logada.'
    """,
]

DOWNGRADE_SQL = ["DROP TABLE IF EXISTS audit.torre_chave_pessoal"]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
