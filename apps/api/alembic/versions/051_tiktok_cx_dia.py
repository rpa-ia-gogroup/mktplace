"""CX do TikTok — cache por (marca, dia) no banco.

POR QUE
-------
A CX do TikTok le a Open API por dia e guarda um agregado compacto por (marca, dia). So' em
memoria, o cache some quando o Render Free dorme, e a 1a abertura volta a levar minutos.
No banco, a API religa e le em segundos; so' os ultimos dias voltam ao TikTok.

O QUE MUDA
----------
Tabela nova `audit.tiktok_cx_dia` (conta, dia, agregado jsonb, lido_em). Nenhuma tabela existente
e' tocada. Sem tokens nem dado pessoal: so' contagens por motivo/SKU.

APLICACAO
---------
Manual no Neon (`alembic upgrade 051`).
"""
from alembic import op

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None

UPGRADE_SQL = [
    """
    CREATE TABLE IF NOT EXISTS audit.tiktok_cx_dia (
        conta     TEXT NOT NULL,
        dia       DATE NOT NULL,
        agregado  JSONB NOT NULL,
        lido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (conta, dia)
    )
    """,
]

DOWNGRADE_SQL = ["DROP TABLE IF EXISTS audit.tiktok_cx_dia"]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
