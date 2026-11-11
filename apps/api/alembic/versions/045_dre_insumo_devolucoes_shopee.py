"""T-0093 — aceita as devolucoes reais da Shopee em marts.fact_dre_insumo_mensal.

POR QUE
-------
A DRE nao tinha devolucao em valor. A Shopee passou a ter: `raw.shopee_returns`
no Data Mart (desde 07/10/2026, lojas com API: apice, barbours, lescent,
rituaria), a mesma fonte do /cx. O `pipelines.dre.insumo_publisher` passa a
publicar o reembolso das devolucoes ACCEPTED por mes de criacao (BRT) x marca
no componente `shopee_devolucao_reembolso`, que a API da DRE ja' le'. O CHECK
`ck_fdim_componente` (025, estendido pela 037 e pela 040) e' lista FECHADA e
recusaria a linha.

O QUE MUDA
----------
SOMENTE o CHECK `ck_fdim_componente`: a lista da 040, literal e na mesma
ordem, com o componente novo no fim. DROP e ADD no MESMO `ALTER TABLE`
(atomico). Nenhuma coluna, linha, indice ou outro CHECK e' tocado. Sem
`IF EXISTS`: sem a 025/037/040 aplicadas a revisao tem de falhar alto.

O publisher le' a definicao do CHECK no Neon e so' publica o componente quando
ele aparece nela: antes desta revisao, nada muda na publicacao.

DOWNGRADE
---------
NAO apaga dado. Se existir linha de `shopee_devolucao_reembolso`, o downgrade
RECUSA com mensagem clara (quem desce decide, explicitamente, o que fazer com
a devolucao publicada). Sem a linha, restaura o CHECK da 040, literal. Mesmo
padrao da 040: o dado e' financeiro e apagar exige decisao humana.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 045`). Nunca pelo
Airflow. Reversivel por `alembic downgrade 044` (ver DOWNGRADE).
"""
from alembic import op

revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None

TABELA = "marts.fact_dre_insumo_mensal"

#: Componentes publicaveis DEPOIS desta revisao: os da 040 + a devolucao Shopee.
#: O CHECK abaixo e' escrito LITERALMENTE (nenhuma chamada no topo do modulo);
#: um teste confere que as listas sao iguais.
COMPONENTES = (
    "cmv",
    "cmv_receita_fiscal",
    "tiktok_taxa_repasse",
    "tiktok_frete_repasse",
    "tiktok_afiliado_repasse",
    "tiktok_receita_repasse",
    "tiktok_residuo_identidade",
    "tiktok_tx_afiliado_maior_taxa",
    "tiktok_transacoes",
    "shopee_taxa_escrow",
    "imposto_icms",
    "imposto_difal",
    "imposto_pis_cofins",
    "shopee_devolucao_reembolso",
)

#: O componente que esta revisao acrescenta.
NOVOS = ("shopee_devolucao_reembolso",)

UPGRADE_SQL = [
    f"""
    ALTER TABLE {TABELA}
        DROP CONSTRAINT ck_fdim_componente,
        ADD CONSTRAINT ck_fdim_componente CHECK (componente IN (
            'cmv', 'cmv_receita_fiscal', 'tiktok_taxa_repasse', 'tiktok_frete_repasse',
            'tiktok_afiliado_repasse', 'tiktok_receita_repasse', 'tiktok_residuo_identidade',
            'tiktok_tx_afiliado_maior_taxa', 'tiktok_transacoes', 'shopee_taxa_escrow',
            'imposto_icms', 'imposto_difal', 'imposto_pis_cofins',
            'shopee_devolucao_reembolso'))
    """,
]

DOWNGRADE_SQL = [
    # Guarda: recusa descer com devolucao publicada. Nada e' apagado aqui.
    f"""
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM {TABELA}
                   WHERE componente = 'shopee_devolucao_reembolso') THEN
            -- Mensagem sem sinal de porcentagem: o texto passa pelo paramstyle do driver.
            RAISE EXCEPTION 'downgrade 045 recusado - {TABELA} tem linhas de devolucao Shopee '
                            '(shopee_devolucao_reembolso). Nada foi apagado. Decida o destino delas '
                            'e remova-as explicitamente antes de descer.';
        END IF;
    END
    $$
    """,
    f"""
    ALTER TABLE {TABELA}
        DROP CONSTRAINT ck_fdim_componente,
        ADD CONSTRAINT ck_fdim_componente CHECK (componente IN (
            'cmv', 'cmv_receita_fiscal', 'tiktok_taxa_repasse', 'tiktok_frete_repasse',
            'tiktok_afiliado_repasse', 'tiktok_receita_repasse', 'tiktok_residuo_identidade',
            'tiktok_tx_afiliado_maior_taxa', 'tiktok_transacoes', 'shopee_taxa_escrow',
            'imposto_icms', 'imposto_difal', 'imposto_pis_cofins'))
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
