"""T-0120b — aceita o repasse da Shopee do escrow em marts.fact_dre_insumo_mensal.

POR QUE
-------
A fato diaria grava `total_settlement` NULL nas lojas Shopee com API
(`COLUNAS_ANULADAS` em pipelines/sync_shopee_daily_api.py) e o repasse Shopee
da Financeiro sai "—". O escrow (`silver.fct_gobeaute_despesas_shopee`, a mesma
fonte da taxa `shopee_taxa_escrow`) tem `valor_repasse` (= `escrow_amount` em
100% das linhas, medido em 16/11/2026). O `pipelines.dre.insumo_publisher`
passa a publicar a soma dele por coorte de criacao do pedido x marca no
componente `shopee_repasse_escrow`. O CHECK `ck_fdim_componente` (025,
estendido pela 037, 040 e 045) e' lista FECHADA e recusaria a linha.

O QUE MUDA
----------
SOMENTE o CHECK `ck_fdim_componente`: a lista da 045, literal e na mesma
ordem, com o componente novo no fim. DROP e ADD no MESMO `ALTER TABLE`
(atomico). Nenhuma coluna, linha, indice ou outro CHECK e' tocado. Sem
`IF EXISTS`: sem a 025/037/040/045 aplicadas a revisao tem de falhar alto.

O publisher le' a definicao do CHECK no Neon e so' publica o componente quando
ele aparece nela: antes desta revisao, nada muda na publicacao.

DOWNGRADE
---------
NAO apaga dado. Se existir linha de `shopee_repasse_escrow`, o downgrade
RECUSA com mensagem clara (quem desce decide, explicitamente, o que fazer com
o repasse publicado). Sem a linha, restaura o CHECK da 045, literal. Mesmo
padrao da 045.

APLICACAO
---------
Operacao manual e explicita no Neon (`alembic upgrade 048`). Nunca pelo
Airflow. Reversivel por `alembic downgrade 047` (ver DOWNGRADE).
"""
from alembic import op

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None

TABELA = "marts.fact_dre_insumo_mensal"

#: Componentes publicaveis DEPOIS desta revisao: os da 045 + o repasse Shopee.
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
    "shopee_repasse_escrow",
)

#: O componente que esta revisao acrescenta.
NOVOS = ("shopee_repasse_escrow",)

UPGRADE_SQL = [
    f"""
    ALTER TABLE {TABELA}
        DROP CONSTRAINT ck_fdim_componente,
        ADD CONSTRAINT ck_fdim_componente CHECK (componente IN (
            'cmv', 'cmv_receita_fiscal', 'tiktok_taxa_repasse', 'tiktok_frete_repasse',
            'tiktok_afiliado_repasse', 'tiktok_receita_repasse', 'tiktok_residuo_identidade',
            'tiktok_tx_afiliado_maior_taxa', 'tiktok_transacoes', 'shopee_taxa_escrow',
            'imposto_icms', 'imposto_difal', 'imposto_pis_cofins',
            'shopee_devolucao_reembolso', 'shopee_repasse_escrow'))
    """,
]

DOWNGRADE_SQL = [
    # Guarda: recusa descer com repasse publicado. Nada e' apagado aqui.
    f"""
    DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM {TABELA}
                   WHERE componente = 'shopee_repasse_escrow') THEN
            -- Mensagem sem sinal de porcentagem: o texto passa pelo paramstyle do driver.
            RAISE EXCEPTION 'downgrade 048 recusado - {TABELA} tem linhas de repasse Shopee '
                            '(shopee_repasse_escrow). Nada foi apagado. Decida o destino delas '
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
            'imposto_icms', 'imposto_difal', 'imposto_pis_cofins',
            'shopee_devolucao_reembolso'))
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_SQL:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_SQL:
        op.execute(stmt)
