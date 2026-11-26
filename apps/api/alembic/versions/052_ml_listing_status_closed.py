"""PMA do ML — `listing_status = 'closed'` (anuncio encerrado) no dominio do destino.

POR QUE
-------
Em 26/11/2026 a fonte trouxe `closed` e o `pma_ml` da cadeia diaria saiu 1 antes do commit
("listing_status fora do dominio: closed"). Anuncio encerrado e' estado legitimo do ML.

O QUE MUDA
----------
Troca o CHECK `ck_fmlpd_listing_status` de `marts.fact_marketplace_listing_price_daily`,
acrescentando 'closed'. So' amplia: toda linha existente continua valida. O downgrade
falha se ja' houver linha `closed` (de proposito: nao apaga dado).

APLICACAO
---------
Manual no Neon (`alembic upgrade 052`), ANTES do pin do airflow com o sync novo.
"""
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None

_TABELA = "marts.fact_marketplace_listing_price_daily"


def _check(estados: str) -> list[str]:
    return [
        f"ALTER TABLE {_TABELA} DROP CONSTRAINT IF EXISTS ck_fmlpd_listing_status",
        f"ALTER TABLE {_TABELA} ADD CONSTRAINT ck_fmlpd_listing_status CHECK (listing_status IN ({estados}))",
    ]


UPGRADE_SQL = _check("'active', 'paused', 'under_review', 'inactive', 'closed'")
DOWNGRADE_SQL = _check("'active', 'paused', 'under_review', 'inactive'")


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
