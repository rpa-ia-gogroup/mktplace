# TikTok — GMV em maturação

Data: 09/11/2026 · Origem: medição T-0072 · Exibição e docs: T-0074
Escopo: **somente TikTok Shop**. Mercado Livre e Shopee não foram medidos (§7).

---

## 1. A regra real do GMV TikTok (o que a Torre serve)

```sql
-- pipelines/connectors/tiktok/connector.py (COMMERCIAL_ORDER_STATUSES)
SUM(total_amount)                       -- dedup por order_id
FROM raw.tiktok_shop_orders
WHERE order_status IN ('COMPLETED', 'DELIVERED', 'IN_TRANSIT',
                       'AWAITING_COLLECTION', 'AWAITING_SHIPMENT')
GROUP BY created_at::date, loja
```

| Item | Valor |
|---|---|
| Fonte | `raw.tiktok_shop_orders` (Data Mart) |
| Coluna de valor | `total_amount`: **inclui o frete pago pelo comprador** (decisão de 07/08/2026, `docs/tiktok_gmv_com_frete_decisao.md`) |
| Status que contam (5) | `COMPLETED`, `DELIVERED`, `IN_TRANSIT`, `AWAITING_COLLECTION`, `AWAITING_SHIPMENT` |
| Status fora | `UNPAID`, `CANCELLED`, `ON_HOLD`. Status novo ou nulo **bloqueia a carga** |
| Grão | dia (`created_at::date`, data do pedido) × loja |
| Destino | `marts.fact_marketplace_daily_performance.gmv` (`marketplace_id = 1`) |
| Contrato | `docs/kpi_dictionary.md` §"TikTok — GMV comercial (Gate DQ-TK1)" e `docs/data_contracts.md` §2 |

> **A descrição "GMV TikTok = `SUM(sub_total)` com 3 status" está desatualizada.**
> Ela vale para o Gate R2/R2.1 (até ago/2026). Desde a decisão do frete (07/08)
> e do Gate DQ-TK1 (25/08), a regra é `total_amount` com 5 status. Documentos
> antigos que ainda citam `sub_total` ou 3 status são registro histórico e remetem
> para cá.

### Por que `AWAITING_*` conta

`AWAITING_COLLECTION` e `AWAITING_SHIPMENT` são **pedidos pagos, aguardando
envio** pelo seller ou coleta pela transportadora. A venda aconteceu, e o envio
é etapa operacional. Prova do Gate DQ-TK1 (01–24/08/2026): 100% desses pedidos
têm `paid_at` preenchido (3.876/3.876 e 4/4), contra 0/611 em `UNPAID`.

Consequência: nos 2–3 dias mais recentes, a Torre fica bem acima de uma conta
feita só com os 3 status de entrega. Esses pedidos ainda não saíram, mas já
estão pagos.

## 2. Por que o valor de um dia ainda cai

Um pedido pago pode ser **cancelado depois** e sair dos 5 status. Pela medição
da T-0072 no log de status (`raw.tiktok_shop_order_status_log`):

- a maior parte dos cancelamentos tardios acontece **entre D+11 e D+30**;
- depois de D+30 o volume é residual: no máximo R$ 5 mil por célula mês × marca,
  e na maioria abaixo de R$ 1 mil;
- **entrada tardia** (pedido que passa a contar depois de D+11) foi **zero** em
  todas as células.

Ou seja, o GMV TikTok de um dia **só cai** enquanto amadurece, e uma janela de
**35 dias** cobre quase todo o movimento.

## 3. A janela diária D-11 e o congelamento

- **Job diário:** `daily_tiktok` = `daily_performance --source tiktok --mode
  incremental --days 10` (`pipelines/ops/orchestrate.py`). Com
  `MIN_INCREMENTAL_LOOKBACK_DAYS = 10`, ele regrava **D-11..D-1**.
- **Gravação:** `INSERT ... ON CONFLICT DO UPDATE`, sem DELETE. Datas fora da
  janela nunca são tocadas.
- **Efeito:** um dia criado em D só é regravado até D+11. Depois disso o valor
  **fica congelado** e mantém pedidos que foram cancelados mais tarde.

Medição da T-0072 em 09/11/2026 (5 marcas, R$). "Status atual" é a mesma regra
de 5 status aplicada hoje na Raw:

| Mês | Torre | Status atual | Excesso da Torre | % | Saída tardia > D+11 |
|---|---:|---:|---:|---:|---:|
| jun | 9.462.232 | 9.462.148 | 84 | 0,00% | regravado |
| jul | 9.803.248 | 9.801.124 | 2.124 | 0,02% | regravado |
| **ago** | 10.951.675 | 10.858.291 | **93.384** | **0,86%** | 98.154 |
| **set** | 10.735.813 | 10.611.410 | **124.403** | **1,17%** | 106.432 |
| **out** | 13.024.673 | 12.914.072 | **110.601** | **0,86%** | 103.309 |

- Jun e jul batem porque foram regravados à mão (reparo que cobriu até ~15/07).
  Na Barbours, a Torre fica acima todo dia de 16/07 a 23/10.
- As saídas tardias explicam de 86% a 105% do excesso de ago–out.
- A marca mais afetada é a Barbours: 1,24% / 2,35% / 1,33% em ago / set / out.
- Out/26 ainda vai mudar: pedidos do fim de outubro podem ser cancelados até ~30/11.

## 4. Decisão de 09/11/2026

1. **Reprocesso semanal de 35 dias:** o orquestrador passa a regravar o TikTok
   com 35 dias uma vez por semana (`daily_performance --source tiktok --mode
   backfill --days 35`). O incremental diário de 11 dias continua para dar
   frescor. *(Em implementação em tarefa paralela; ver `pipelines/ops/orchestrate.py`.)*
2. **Reparo único desde 16/07:** `refresh_tiktok_daily_contract` de 16/07 até
   hoje−11, em janelas ≤ 31 dias, com dry-run conferindo a coluna "status atual"
   acima. É escrita no banco e depende da aprovação do supervisor.
3. **Rótulo "em maturação":** a API e a tela marcam os dias com menos de 35
   dias desde a data do pedido. **O número não muda**, só o rótulo (§5).
4. **A regra do GMV não muda:** continua `total_amount` com 5 status (§1).

## 5. O rótulo "em maturação" (API e tela)

**Regra:** um dia `d` está em maturação quando `d >= hoje − 35`, com `hoje` em
`America/Sao_Paulo`. O dia de fronteira entra de propósito: é mais seguro marcar
um dia a mais do que apresentar como fechado um dia que ainda pode cair.

**API** (campos opcionais e aditivos; com o TikTok fora do escopo, ficam `null`):

| Rota | Campo |
|---|---|
| `GET /api/v1/performance/daily` | `tiktok_maturacao` (bloco) e `data[].tiktok_em_maturacao` (por dia) |
| `GET /api/v1/performance/monthly` | `tiktok_maturacao` (bloco) e `data[].tiktok_em_maturacao` (mês com ao menos 1 dia em maturação) |
| `GET /api/v1/performance/brands` | `tiktok_maturacao` (bloco; o cliente compara com `date_to`) |

```json
"tiktok_maturacao": {
  "em_maturacao_desde": "2026-10-05",
  "janela_dias": 35,
  "motivo": "cancelamentos ate ~D+30; valor pode cair"
}
```

Código: `apps/api/app/services/performance_service.py`
(`TIKTOK_MATURACAO_JANELA_DIAS`, `tiktok_maturacao_info`) e
`apps/api/app/schemas/performance.py` (`TikTokMaturacao`).

**Tela:** na Marca 360 (`/brand/[marca]`), abaixo do gráfico "GMV Diário",
aparece "TikTok em maturação desde dd/mm · valor pode cair" com um "ⓘ" que
explica o motivo. O rótulo só aparece com dado ao vivo, com TikTok no filtro e
quando a API manda `tiktok_em_maturacao`. Uma API antiga, sem o campo, não exibe
nada. Helper: `apps/web/src/lib/tiktok-maturacao.ts`.

## 6. Dono e cadência

| Item | Valor |
|---|---|
| Dono do número | Mário (dono do GMV da Torre; decisões de 07/08 e 09/11) |
| Carga diária | `daily_tiktok`, D-11..D-1, diária pelo orquestrador |
| Reprocesso | semanal, 35 dias (decisão de 09/11; implementação em andamento) |
| Rótulo | calculado a cada requisição, sem carga própria |
| Revisar quando | o reprocesso semanal estiver ativo e o reparo desde 16/07 tiver rodado. Nesse ponto, medir de novo Torre × status atual (consultas da T-0072) |

## 7. Limites e pendências

- Mercado Livre e Shopee usam o mesmo `daily_performance` com janela curta. É
  provável que tenham o mesmo congelamento, mas **não foi medido**. O rótulo
  vale só para o TikTok.
- A mudança de valor (`total_amount` alterado depois de D+11) não foi medida
  pedido a pedido, porque o log registra só o status. Resíduo de 0 a +14% do
  excesso.
- Home, Canais e Financeiro usam `/overview`, `/canais` e `/financeiro`, que
  ainda não levam o rótulo. Hoje ele aparece só na Marca 360 (§5).
