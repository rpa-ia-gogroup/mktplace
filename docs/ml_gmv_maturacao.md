# Mercado Livre — GMV em maturação

Data: 09/11/2026 · Origem: medição T-0075 · Correção, rótulo e docs: T-0077
Modelo: `docs/tiktok_gmv_maturacao.md` (T-0074). Mesmo desenho, outra janela.

---

## 1. A regra do GMV ML (o que a Torre serve)

| Item | Valor |
|---|---|
| Fonte | `gold.ml_gestao_diaria.gmv` (VIEW no Data Mart), lida por `pipelines/connectors/mercadolivre/connector.py` |
| Regra medida | `SUM(api.ml_orders.total_amount)` com `status = 'paid'`, por `date_created::date` × marca (igualdade exata em 248/248 células, MARGEM-REAL-2) |
| Fora do GMV | `cancelled` e `partially_refunded` |
| Grão | dia (data de criação do pedido) × marca; `apice` fora do escopo (`BRANDS_IN_SCOPE`) |
| Destino | `marts.fact_marketplace_daily_performance.gmv` (`marketplace_id = 2`) |

A regra não muda nesta tarefa. Só a frequência com que o passado é regravado.

## 2. O defeito: o GMV congela em D+4

- **Job diário:** `daily_ml` = `daily_performance --source ml --mode incremental`
  (sem `--days`). O conector usa `fetch_incremental(days_back=3)` e regrava
  **D-4..D-1**.
- **Gravação:** `INSERT ... ON CONFLICT (date, loja_id, marketplace_id) DO UPDATE`,
  sem DELETE. Datas fora da janela não são tocadas.
- **Efeito:** um pedido pago em D e cancelado depois de D+4 continua no GMV da
  Torre para sempre.

Medição da T-0075 (09/11/2026, 4 marcas, R$; relatório em
`.artefacts/deliveries/gmv-maturacao-ml-shopee/T-0075_relatorio.md`):

| Mês | Torre | Status atual | Excesso da Torre | % |
|---|---:|---:|---:|---:|
| jun | 4.567.894 | 4.570.461 | −2.567 | −0,06% |
| jul | 5.778.258 | 5.759.491 | 18.767 | +0,33% |
| ago | 4.551.186 | 4.522.912 | 28.274 | +0,63% |
| **set** | 4.750.476 | 4.622.543 | **127.933** | **+2,77%** |
| **out** | 4.850.781 | 4.789.620 | **61.160** | **+1,28%** |

Quando os cancelamentos tardios acontecem: a faixa D+5..D+35 concentra quase
tudo; **35 dias pegam 95–97%** das saídas tardias de jun–set, e depois de D+60 o
resíduo é de no máximo R$ 131 por mês.

## 3. A correção (T-0077)

### 3.1 Reprocesso semanal de 35 dias

`ML_WEEKLY_REPROCESS_STEPS` em `pipelines/ops/orchestrate.py`:

```
python -m pipelines.ingestion.daily_performance --source ml --mode backfill --days 35
```

- Janela: `closed_window(35)` = **D-36..D-1**. Com cadência semanal, cada dia é
  regravado pela última vez com idade entre 30 e 36 dias.
- Mesmo caminho do diário: `fato_diaria_lock`, `audit.source_sync_run`, checks de
  qualidade, defesa de dia fechado e guardrail de comissão (MARGEM-REAL-2B), que
  falha fechado antes de escrever.
- Timeout de 900 s (o mesmo do `daily_ml`), preflight `ml_daily`, crítico.
- **Premissa não medida:** a leitura é a VIEW com o CTE de comissão, e o MAX da
  view já levou 52–120 s (OPS-RECOVERY-3/5). A primeira janela de 31 dias do
  reparo (§3.2) é a medição. Se ela passar de ~600 s, dividir o reprocesso em
  dois passos. Isso exige argumento relativo novo, porque `--date-from/--date-to`
  são datas absolutas e os argumentos do passo são fixos.
- **Ainda não está em `PIPELINES`.** O inventário de pipelines é conferido
  literalmente por `pipelines/tests/test_ops_s3_wiring.py` e
  `pipelines/tests/test_ue2c_automacao_afiliados.py`, que ficam fora do escopo da
  T-0077. Para registrar, basta a linha
  `PIPELINES["ml_weekly_reprocess"] = ML_WEEKLY_REPROCESS_STEPS` e acrescentar o
  nome nesses dois testes e em `test_ops_orchestrate.py`. O agendamento de
  produção (Airflow, outro repositório) copia o comando acima.

**Por que UPSERT basta (sem DELETE):** `gold.ml_gestao_diaria` é agregado dia ×
marca que conta todos os status (expõe `cancelled_orders` e `cancel_rate_pct`). O
filtro `paid` fica no `gmv`, não na existência da linha. Um (dia, marca) cujos
pedidos foram todos cancelados continua com linha (gmv=0), e o UPSERT a
sobrescreve. **Premissa:** a definição da VIEW está no Data Mart, não neste repo.
O dry-run do reparo mede isso em `chaves_so_no_destino`, que deve ser 0.

### 3.2 Reparo único: 01/07/2026 até hoje−5

`pipelines/ops/refresh_ml_daily_contract.py`. O fim padrão é hoje−5 porque
D-4..D-1 já é regravado pelo incremental diário.

```
# dry-run (padrão): lê fonte e destino em READ ONLY, não escreve nada
python -m pipelines.ops.refresh_ml_daily_contract

# apply: regrava pelo pipeline diário, janela a janela
python -m pipelines.ops.refresh_ml_daily_contract --apply

# janela explícita (as duas pontas inclusivas; teto D-1)
python -m pipelines.ops.refresh_ml_daily_contract --date-from 2026-07-01 --date-to 2026-11-04
```

- **Janelas:** no máximo 31 dias, cortadas na virada do mês. O padrão de hoje
  (09/11) é jul, ago, set, out e 01–04/11.
- **Dry-run:** para cada janela, lê a fonte pela consulta do conector e o destino
  em transação `READ ONLY`. Mostra:
  - o resumo **mês × marca, antes × depois** (antes = destino hoje; depois =
    fonte), com `delta = depois − antes`. O excesso da T-0075 aparece como delta
    negativo;
  - `chaves_com_gmv_ou_pedidos_alterados`, `chaves_novas` e `chaves_so_no_destino`;
  - se o guardrail de comissão reprovaria a janela (`guardrail_comissao`).
- **Apply:** chama `daily_performance.run(source="ml", mode="backfill",
  date_from, date_to)` por janela. É UPSERT sem DELETE. Uma barreira
  (`WindowViolation`) recusa qualquer linha fora da janela antes do upsert. Cada
  janela é uma transação: se uma falhar, as anteriores ficam gravadas, a execução
  para com exit 2, e rodar de novo é idempotente. No fim, imprime o resumo mês ×
  marca entre o destino antes e o destino depois.
- **Efeito esperado** (coluna "status atual" da §2): jul −R$ 18,8 mil, ago
  −R$ 28,3 mil, set −R$ 127,9 mil, out −R$ 61,2 mil. Os números do dry-run podem
  diferir um pouco, porque a fonte continua amadurecendo.
- É escrita no banco: rodar o apply só depois do dry-run e do `pass` do
  supervisor.

### 3.3 `--days` no modo incremental

O `daily_performance` ignora `--days` no modo incremental, em **todas** as
fontes, e continua assim. Por isso o `dia_ml --days 2 --incluir-hoje` do Airflow
cobre a janela padrão do conector (D-3..D0), e não D-2..D0 como diz o comentário
dele.

Decisão (revisão R141): **o comportamento não muda; o descarte deixa de ser
silencioso.**
- `--days` passou a ter default `None`, para distinguir "não veio" de "veio 3".
  Sem `--days`, nada muda: o incremental usa a janela do conector, e o backfill
  continua em 3 (`BACKFILL_DAYS_PADRAO`).
- Com `--mode incremental --days N`, em qualquer fonte, o valor não chega ao
  conector e o log registra `--days N ignorado no modo incremental`.
- Quem precisa de uma janela por `--days` usa `--mode backfill`, como o
  reprocesso semanal (§3.1).

**Barreira de janela exata (`WindowViolation`):** com `--date-from/--date-to`,
uma linha fora da janela pedida bloqueia a carga antes do upsert **só no ML**.
Nas demais fontes (TikTok, `shopee-stats`), a mesma situação gera apenas um aviso
no log, e a carga segue como antes.

## 4. O rótulo "em maturação" (API e tela)

**Regra:** um dia `d` está em maturação quando `d >= hoje − 35`, com `hoje` em
`America/Sao_Paulo`. O dia de fronteira entra no rótulo, como no TikTok. **O
número não muda.**

**API** (campos opcionais e aditivos; com o ML fora do escopo, ficam `null`):

| Rota | Campo |
|---|---|
| `GET /api/v1/performance/daily` | `ml_maturacao` (bloco) e `data[].ml_em_maturacao` (por dia) |
| `GET /api/v1/performance/monthly` | `ml_maturacao` (bloco) e `data[].ml_em_maturacao` (mês com ao menos 1 dia em maturação) |
| `GET /api/v1/performance/brands` | `ml_maturacao` (bloco) |

```json
"ml_maturacao": {
  "em_maturacao_desde": "2026-10-05",
  "janela_dias": 35,
  "motivo": "cancelamentos ate ~D+35; valor pode cair"
}
```

Código: `apps/api/app/services/performance_service.py`
(`ML_MATURACAO_JANELA_DIAS`, `ml_maturacao_info`) e
`apps/api/app/schemas/performance.py` (`MlMaturacao`).

**Tela:** na Marca 360 (`/brand/[marca]`), abaixo do gráfico "GMV Diário",
aparece "Mercado Livre em maturação desde dd/mm · valor pode cair", com um "ⓘ".
O rótulo só aparece com dado ao vivo, com ML no filtro e quando a API manda
`ml_em_maturacao`. Helper: `apps/web/src/lib/ml-maturacao.ts`.

## 5. Shopee: quebra de régua em 23/08/2026 (só rótulo)

A série de GMV da Shopee mistura **duas réguas**. Nada foi republicado nem
alterado:

| Período | Lojas | Régua | Diferença para a régua atual |
|---|---|---|---|
| até 22/08/2026 | apice, barbours, lescent, rituaria | shop-stats dos arquivos (vitrine, líquido de cancelado **e devolvido**, congelado no download) | Torre **2,1% a 3,0% abaixo** |
| desde 23/08/2026 | as mesmas 4 | pedidos via API (`sync_shopee_daily_api`): `SUM(item_total)` com `order_status <> 'cancelled'`, janela de 60 dias | bate ao centavo (T-0075) |
| todo o período | kokeshi | shop-stats dos arquivos | não medido |

**Como ler comparações:** qualquer comparação Shopee que cruze 23/08/2026 (mês
contra mês de ago contra set, ano contra ano, média móvel) traz um viés de ~2,5%
para cima no lado posterior, por definição e não por venda. Rotule assim:
"Shopee: régua muda em 23/08/2026 (shop-stats → pedidos); antes ~2–3% abaixo".

A Shopee das 4 lojas com API **não congela**: a janela de 60 dias cobre os
cancelamentos (zero depois de D+60). Por isso não há reprocesso nem rótulo de
maturação para ela nesta tarefa. Republicar jan–22/08 pela régua nova
(`sync_shopee_daily_api --desde 2026-01-01 --apply`) é decisão do Mário e ficou
fora.

## 6. Dono e cadência

| Item | Valor |
|---|---|
| Dono do número | Mário |
| Carga diária | `daily_ml`, D-4..D-1 |
| Hora a hora | `dia_ml --days 2 --incluir-hoje`: o `--days` é ignorado, cobre D-3..D0 (§3.3) |
| Reprocesso | semanal, 35 dias (`ML_WEEKLY_REPROCESS_STEPS`; falta registrar e agendar) |
| Reparo | único, 01/07..hoje−5 (`refresh_ml_daily_contract`) |
| Rótulo | calculado a cada requisição |
| Revisar quando | o reparo tiver rodado e o reprocesso estiver agendado: medir de novo Torre × status atual com as consultas da T-0075 |

## 7. Limites

- A VIEW `gold.ml_gestao_diaria` não está versionada neste repo. A premissa "linha
  existe com todos os status" vem das colunas expostas e é medida no dry-run.
- Mudança de `total_amount` depois de D+4 não foi medida (o ML não tem log de
  valor).
- O tempo da leitura de 31–36 dias da VIEW não foi medido (§3.1).
- Home, Canais e Financeiro ainda não levam o rótulo. Ele aparece só na Marca 360,
  como o do TikTok.
