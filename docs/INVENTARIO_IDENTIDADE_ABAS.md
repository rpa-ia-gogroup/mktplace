# Inventário de identidade por aba — o que está fora do padrão da Gerencial

> Levantamento por leitura de código em `origin/main` (commit `e56338a`, 10/11/2026).
> Nada foi renderizado no navegador; prints antes/depois entram em cada PR da fase 2.
> O padrão está em `docs/IDENTIDADE_GERENCIAL.md`. Caminhos relativos a `apps/web/`.
> Linhas com `~` são aproximadas.

## Como ler

Códigos de falta, os mesmos do checklist da seção 13 do padrão:

| Código | Peça |
|---|---|
| G1 | identidade em cor (borda `border-kpi-*` + brilho) |
| G2 | ladrilho de ícone no canto |
| G3 | valor grande (`text-2xl`, `NumeroAnimado`) |
| G4 | pílula de variação (`DeltaBadge`) |
| G5 | "antes X" |
| G6 | sparkline com ponto final |
| G7 | hover `card-hover` + `<button>` com `aria-haspopup` (ou `aria-pressed` quando filtra) |
| G8 | clique abre `KpiDrilldownDialog` com as peças `Drilldown*` |
| G9 | esqueleto de carregamento no formato do cartão |
| G10 | vazio/ausente/erro via `StateBlock` (`—` com motivo, nunca zero) |

**Regra de ausência:** onde está escrito "sem dado", a API/estado da tela não entrega
período anterior ou série. G4, G5 e G6 ficam de fora; não se inventa nada. G4/G5
só entram quando o período anterior é real.

Prioridade: **P0** faixa de KPIs no topo da aba; **P1** cartões secundários, modais
fora do padrão e estados; **P2** tabelas e detalhe.

## 1. Resumo (o que decide a ordem da fase 2)

| Aba | Rota | Tematizada (escuro)? | Faixa de KPIs hoje | Dado para G4/G5/G6 | Esforço | Dono |
|---|---|---|---|---|---|---|
| Marcas menores | `/marcas-menores` | sim | herói próprio; sem faixa | anterior, série e pedidos **existem** | P/M | — |
| Canais | `/canais` | sim | 15 `StatCard` | sem dado | M | — |
| Pedidos | `/pedidos` | não | 4 `KpiCard` legado | série diária **existe**; anterior sem dado | M | — |
| Qualidade | `/qualidade` | não | 7 `KpiCard` legado | sem dado | M | — |
| Ações ML + TikTok | `/inteligencia` | não | 3 cartões próprios; modais **já no padrão** | sem dado | M | — |
| Regiões | `/regioes` | não | 6 `KpiCard` legado | série nacional existe; anterior sem dado | M/G | — |
| Produtos | `/produtos` | não | Pareto A/B/C/D próprio | sem dado | P/M | — |
| Financeiro | `/financeiro` | sim | 3 painéis por canal (não é KPI único) | sem dado | M/G | — |
| DRE | `/dre` | sim | 8 `KpiTile` faixa | sem dado | M | — |
| Monitoramento de preços | `/monitoramento-preco` | não | 6+ botões próprios que filtram | sem dado | M | — |
| Monitoramento · Revendedores | `/monitoramento-preco/revendedores` | não | `StatCard` | sem dado | P | — |
| Criadores + Alertas | `/operacoes` | não | não existe faixa | sem dado | G | — |
| Performance das contas | `/performance-contas` | não | `IndicadorItem` | sem dado | M | — |
| Metas | `/metas` | sim | tela de edição | n/a | P | — |
| Página de marca | `/brand/[brand]` | não | 4 `KpiCard` legado | anterior e série **existem** (`prevDaily`, `daily`) | M/G | — |
| Full | `/full` | sim | já em `KpiTile`; resíduo no modal | só foto anterior | M | Front · Full |
| Expedição | `/expedicao` | sim | gestor já no padrão; resíduo no detalhe e modais | série horária existe | M | Front · Expedição |
| CX | `/cx` | sim | Shopee já no padrão; ML sem clique | `rodapeComparacao` existe | P/M | Front · CX |

Fatos que valem para várias abas:

1. **Só 9 rotas estão em `ROTAS_TEMATIZADAS`** (`src/lib/theme.ts:91`): `/expedicao`, `/`, `/canais`, `/financeiro`, `/dre`, `/metas`, `/cx`, `/full`, `/marcas-menores`. As outras renderizam em claro fixo. `KpiTile` funciona nelas, mas o escuro só vem quando a rota entra na lista, e isso exige migrar os literais `bg-white`/`violet`/`slate` da página inteira. **Um PR de cartões não faz essa migração.**
2. **Esqueleto compartilhado não existe (G9 em quase todas).** `KpiCardSkeleton` é privado de `components/gerencial/KpiBand.tsx:75`; o `SkeletonKpiCard` de `components/Skeleton.tsx:1` é o legado.
3. **`KpiCard` legado (`components/KpiCard.tsx`) e `StatCard` (`ui/StatCard.tsx`) são compartilhados** entre abas. Trocar o uso na tela, nunca o componente.
4. **`IdentidadeKpi` só tem 7 valores** (`gmv`, `pedidos`, `ticket`, `ads`, `roas`, `prazo`, `atendimento`). Canais (TikTok/ML/Shopee), cancelamento, devolução e curva A/B/C/D não têm identidade. Mapear ou criar token é decisão de design (ver seção 4).
5. **Quase nenhuma aba tem período anterior em KPI**; Canais, Financeiro e Pedidos usam `hideCompare`. Pílula e "antes" ficam de fora, exceto Marcas menores e Página de marca.
6. **Nenhuma aba tem modal fora do `KpiDrilldownDialog`.** O que falta é o conteúdo montado com as peças `Drilldown*` e, em muitas, o próprio clique.
7. **Uma lacuna no próprio padrão afeta todas as abas** (seção 12 do padrão, item 1): o modal da Gerencial não herda ícone e cor do cartão, e o gráfico dele usa `text-accent`. Replicar "modal no mesmo estilo" depende de decidir isso antes.

## 2. Inventário por aba

### Marcas menores (`app/marcas-menores/page.tsx`, `components/marcas-menores/Blocos.tsx`)

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Topo "Receita das marcas" (total, variação, rosca por canal) | `Blocos.tsx:75` (`Topo`), chamado em `page.tsx:76` | `<section>` próprio, borda `border-kpi-gmv/30` | G2 G3 (`text-3xl font-bold` sem `NumeroAnimado`) G4 (`Variacao` própria, não `DeltaBadge`) G5 G6 G7 G8 | total e anterior sim (`Consolidado.total_anterior`); série diária sim (`MarcaMenor.serie`) | P0 |
| Faixa GMV/Pedidos/Ticket | não existe nesta aba | — | A Gerencial já tem em `GerencialMarcasMenores.tsx:35` (`KpiBand` + `overviewDeMenores` + `buildKpiBand`). Reusar | sim; Ads/ACOS "sem dado" | P0 |
| Linha por marca (barra por canal, total, variação) | `Blocos.tsx:144-199` (`Marcas`) | `<li>` sem clique | G8 (detalhe por marca) | sim | P1 |
| Carregando | `Blocos.tsx:298` (`EsqueletoMarcasMenores`) | 3 blocos genéricos | G9 | — | P1 |
| Erro/indisponível | `page.tsx:68-70` | `StateBlock` | ok | — | ok |
| Modal | não existe | — | G8 | — | — |

Esforço P/M. Riscos: `Topo`, `Marcas` e `Produtos` são importados também por `app/page.tsx:68` e `GerencialMarcasMenores.tsx:21`; não mudar assinatura. O `onOpen` da `KpiBand` na Gerencial aponta para esta aba (`abrirAbaMenores`); aqui precisa de `onOpen` próprio. Números e regras do consolidado ("parcial sem X") não mudam.

### Canais (`app/canais/page.tsx`)

Os cartões são `StatCard`: ponto de cor e ladrilho cinza, sem borda de identidade, hover, clique, pílula nem sparkline.

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Mix TikTok: Vídeo, Live, Card/vitrine, Conversão (4) | `page.tsx:766-790` (esqueleto 763) | `StatCard` `canal=bg-canal-*` | G1 G2 G3 G7 G8 | G4–G6 sem dado; G8: `tiktok_gmv_*`, `tiktok_customers` e linhas por marca existem | P0 |
| Mercado Livre: Novos, Recompra, GMV/Comprador (3) | `page.tsx:987-1005` | `StatCard` | G1 G2 G3 G7 G8 | por marca em `CanaisBrandRow` | P0 |
| Shopee: Novos, Recompra, GMV/Comprador, Visitantes, Conversão (5) | `page.tsx:1121-1150` | `StatCard` | G1 G2 G3 G7 G8 | idem | P0 |
| Afiliados (resumo + modal) | `components/AffiliateCostsPanel.tsx:220` (botão 229, dialog 338, esqueleto 185-197) | seção própria + `KpiDrilldownDialog` só com `DrilldownSecao` | G8 parcial (faltam `EvidenceRow`, `DataQualityNote`, `DrilldownCta`); G9 (`bg-accent-soft`); G10 (`<p>` solto) | — | P1 |
| Descontos TikTok (resumo + modal) | `components/TiktokOrderDiscountsPanel.tsx:142` (botão 151, dialog 260, esqueleto 88-101) | idem | idem | — | P1 |
| Canais lado a lado | `components/canais/ChannelOverview.tsx:139-223` | `Panel` + barra + tabela | não é KPI | — | P1 |
| Faixa de reconciliação TikTok | `page.tsx:798-826` | `div bg-raised` com N/D | G10 (N/D sem motivo; ⓘ existe) | — | P2 |
| Placeholder Shopee sem dados | `page.tsx:1159` | `div border-dashed` à mão | G10 → `StateBlock indisponivel` | — | P2 |
| Comparativo marca×canal + modal | `page.tsx:678-690`, `ChannelComparisonDialogContent.tsx:136-242` | `KpiDrilldownDialog` + peças completas | **ok** | — | ok |
| Erro/vazio da página | `page.tsx:570, 583` | `StateBlock` | ok | — | ok |

Esforço M. Trocar 15 `StatCard` por `KpiTile` resolve G1–G3 e G7; sem anterior nem série, G4–G6 ficam de fora. O drilldown por KPI (G8) é a parte cara e pode ir em PR separado. Riscos: `StatCard` é usado também em Revendedores; `ChannelComparisonDialogContent` é usado na Gerencial (`app/page.tsx:78`); `page.tsx` tem 1312 linhas e abas internas, conflita fácil. Precisa de identidade para canal (decisão 1).

### Pedidos (`app/pedidos/page.tsx`) — rota não tematizada, paleta legada

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 4 KPIs: Total de pedidos, GMV total, Ticket médio, Taxa de cancelamento | `page.tsx:403-430` (grade 400) | `KpiCard` legado (`text-3xl font-bold`; ponto do cancelamento muda por faixa) | G1 G2 G3 G7 G8 G9 (`opacity-50`) G10 ("—" sem motivo) | anterior sem dado (`hideCompare`); **série diária real** em `displayData.daily` serve a Pedidos e GMV (G6); ticket e cancelamento são razões dessa série; `by_brand` e `daily` servem a G8 | P0 |
| 2 `CanalCard` (TikTok, ML) | `page.tsx:69-100`, usados em 437/447 | local, `rounded-2xl p-5`, 4 mini-métricas | G1 G2 G3 G7 G8 | série por canal (`tiktok_orders`, `ml_orders`) existe | P1 |
| Estados | `page.tsx:381-395, 437-460, 508-514` | caixa `rose-50` própria + `bg-white` repetindo; "API offline" em `div` | G10 → `StateBlock` | — | P1 |
| Gráfico diário, tabela por marca | `page.tsx:~462-505`, `133-205` | `bg-white`, hex em Recharts | paleta legada | — | P2 |
| Modal | não existe | — | — | — | — |

Esforço M. Riscos: não alterar `KpiCard`; `BrandTable` e `CanalCard` são locais, sem conflito.

### Qualidade (`app/qualidade/page.tsx`) — rota não tematizada, paleta legada

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 7 KPIs condicionais por canal (Entrega TK, Cancelamento/Devolução TK N/D, Cancelamento/Não entregue/Entrega ML, Cancelamento/Devolução Shopee) | `page.tsx:312-370` (grade 303) | `KpiCard` legado (`rounded-2xl shadow-sm p-5`, `text-3xl font-bold`, ponto fixo) | G1 G2 G3 G7 G8; `subvalue` (metodologia) deve ir para o ⓘ | G4–G6 sem dado; G8: `QualityBrandRow` por marca em `displayBrands` | P0 |
| Cards N/D do TikTok | `page.tsx:325-333`, `lib/quality-availability.ts` | "N/D" + "Não disponível nesta fonte" | G10 já correto (nunca zero); só trocar o visual (`border-dashed`) | — | P0 |
| Carregamento | `page.tsx:303` | `opacity-50` com "—" | G9 | — | P0 |
| Erro | `page.tsx:260-278`, `290-294` | caixa `rose-50` + bloco `bg-white` repetindo | G10 → `StateBlock erro` + `RetryButton` | — | P1 |
| Tabelas por marca, Fidelização ML, Shopee, Produtos Shopee | `page.tsx:~380, 478, 560, 575` | `bg-white border-violet-100`; legenda "<2% 2–5% >5%" em 3 blocos | tabelas; legenda contradiz "menos legendas" | — | P2 |
| Modal | não existe | — | — | — | — |

Esforço M. Riscos: `KpiCard` é usado por Regiões, Pedidos, Full ML, Full Shopee e Marca; não alterar. Não tocar nas cores de severidade legadas neste PR.

### Ações ML + TikTok (`app/inteligencia/page.tsx`, `components/inteligencia/*`) — rota não tematizada

Aba mais perto do padrão: **todos os modais já usam o shell e as peças `Drilldown*`.**

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 3 cartões de prioridade (Parar, Escalar, Testar) | `PriorityCards.tsx:42-72`, usado em `page.tsx:496` | `<button>` real, mas `bg-white border-violet-100 rounded-2xl`, `text-2xl font-bold` | G1 (cores próprias rose/emerald/amber) G2 G3 G7 (sem `card-hover`, sem `aria-haspopup`) | valor e contagem sim; anterior/série sem dado | P0 |
| Detalhes: prioridade, quadrante, ponto, faixa, bucket, evidência | `page.tsx:791-1075` | `KpiDrilldownDialog` + `Drilldown*` + `focusResetKey` | **ok** | sim | ok |
| Matriz de oportunidades | `OpportunityMatrix.tsx:139,177,305,115` | botões com borda slate, `hover:border-violet-300` | G7 de leve | sim | P1 |
| Carregando | `page.tsx:161` (`InteligenciaSkeleton`) | 3 `SkeletonKpiCard` + blocos `bg-slate-*` | G9 | — | P1 |
| Erro/vazio | `page.tsx:454, 458` | `div` violeta com `<p>` + botão | G10 → `StateBlock` | — | P1 |
| Concentração, Fila de evidências | `ConcentrationBars.tsx:56`, `EvidenceQueue.tsx:223,267` | botões que abrem o diálogo | ok | sim | P2 |
| Produtos TikTok em destaque, LTV | `page.tsx:627-668`, `~700` | `SectionCard`; vazio é `<p>` solto | G10 | — | P2 |

Esforço M. Riscos: `PriorityCards` só é usado aqui; o shell do diálogo é compartilhado por 6 conteúdos; não esconder a ressalva de amostra (`p.limitation`, hoje no ⓘ).

### Regiões (`app/regioes/page.tsx`) — rota não tematizada, literais violet/white

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| GMV regional, Pedidos, UFs com venda, % UF preenchida | `page.tsx:345,359,364,369` | `KpiCard` legado | G1–G8 | anterior sem dado (`hideCompare`); série em `RegiaoTrendPoint` (`api-client.ts:2203`), **escopo nacional, ignora o filtro de UF** — só usar com essa ressalva | P0 |
| Cobertura Custo Frete, Custo Frete Seller | `page.tsx:377,383` | `KpiCard` legado (2ª linha, `-mt-2`) | G1 G2 G7 G8 | sem dado | P1 |
| Carregando | `page.tsx:344` | "—" sem esqueleto | G9 + G10 (sem motivo) | — | P0 |
| Erro/vazio | `page.tsx:323, 331` | `div` violeta com `<p>` | G10 | — | P1 |
| Mapa por UF | `RegioesBrazilMap.tsx:105-115` | `role=button` por UF; **filtra**, não abre modal | manter | — | P2 |
| Ranking, Marca×Canal, Tendência | `page.tsx:395, 440, 502` | `bg-white border-violet-100 rounded-2xl` | casca → `Panel` | — | P2 |

Esforço M/G (página de ~570 linhas com literais; mexer só nos KPIs deixa a aba meio-padrão). Risco alto de conflito com qualquer outro PR em Regiões.

### Produtos (`app/produtos/page.tsx`) — rota não tematizada, paleta legada nas 3 abas

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Pareto A/B/C/D (4), nas 3 abas | `components/ProductParetoSummary.tsx:82-110` | `<button aria-pressed>` de filtro, cores fixas por bucket, `tc-barra` | G1 (fora dos tokens) G2 G3 G7; **filtra a tabela, não abre modal** → `KpiTile ativo` + `acaoFalada` | `buckets` traz só gmv, gmv_pct, count; G4–G6 sem dado | P0 |
| Esqueleto do Pareto | `ProductParetoSummary.tsx:54-58` | 4 blocos `h-[104px]` slate | G9 | — | P0 |
| "Sem valor confiável" | `ProductParetoSummary.tsx:62-72`, `page.tsx:~705` | `p border-dashed` slate | G10 → `StateBlock indisponivel` | — | P1 |
| ScopeQualityBanner | `components/ScopeQualityBanner.tsx:38+` | faixa de aviso com ⓘ, esqueleto slate | não é KPI | — | P2 |
| Marcas menores indisponíveis | `page.tsx:~725` | `p border-dashed` slate | G10 | — | P2 |
| Tabelas ML/TikTok/Shopee | `components/ProductTableShell.tsx:100-120` | vazio/offline como `<td>` | G10 | — | P2 |
| Modal | não existe | — | — | — | — |

Esforço P/M se só o Pareto; M se migrar a paleta. Risco: `ScopeQualityBanner` também é usado em Qualidade.

### Financeiro (`app/financeiro/page.tsx`, `components/financeiro/*`) — tematizada, usa tokens

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 3 painéis por canal (TikTok `:351`, ML `:377`, Shopee `:420`) | `ChannelCostPanel.tsx:56-118` | `section rounded-xl border-line`, cabeçalho com ponto de canal + `text-2xl` GMV, linhas valor/%/barra | G1 G2 G3 G7 G8 | G4–G6 sem dado; G8: `FinanceiroBrandRow` por marca existe | P0 |
| Esqueleto | `ChannelCostPanel.tsx:77-79` | só o valor pulsa | G9 | — | P1 |
| "—" sem motivo | `page.tsx:~357-358` | "—" quando `null` | G10 (motivo no ⓘ) | — | P2 |
| Ausências ("Sem fonte", "Só por marca") | `ChannelCostPanel.tsx:92-96` | chip `border-dashed` com motivo | **ok** | — | ok |
| Erro/vazio, gráfico por marca | `page.tsx:332-345`, `475-489` | `StateBlock`, `Panel` | **ok** | — | ok |
| Tabelas por marca | `page.tsx:502, 565, 649` | `Panel` + `SortHeader` | — | — | P2 |

Esforço M/G. **Decisão 2:** o painel por canal tem várias linhas, não cabe em um `KpiTile`. Opção A: manter o painel com borda e brilho do canal e torná-lo botão com modal. Opção B: 3 `KpiTile` de GMV por canal no topo + painel no modal. Riscos: `ChannelCostPanel` e `FeeByBrandChart` só são usados aqui; canais não têm identidade (decisão 1).

### DRE (`app/dre/DreClient.tsx`, `components/dre/*`) — tematizada

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Receita, Margem conhecida, % da receita, Classificação | `DreResumo.tsx:71,79,86,92` | `KpiTile` **faixa** | G1 G2 G3 G7 G8 G9 | só o mês; anterior e série sem dado (`CelulaDRE`) | P0 |
| Resumo estimado (Receita base, Margem estimada, %, Premissas) | `DreEstimada.tsx:89,95,107,113` | `KpiTile` faixa | idem | idem | P0 |
| Comparação por canal | `DreCanais.tsx:61` | `Panel` + `<dl>` sem clique | G8 opcional | `motivos_classificacao` e `custos_ausentes` já dariam o modal | P1 |
| Carregando | `DreClient.tsx:218` | `StateBlock` único | G9 | — | P1 |
| "por quê?" da classificação | `DreMarcas.tsx:199` | botão inline com `aria-expanded` | aceitável | sim | P2 |
| Conhecida × Estimada | `DreEstimada.tsx:~185` | `Panel` + `<dl>` | visual | sim | P2 |
| Vazio/erro/indisponível | `DreClient.tsx:220,246`, `DreEstimada.tsx:65,73` | `StateBlock` | ok (margem ausente vira status, nunca zero) | — | ok |
| Modal | não existe | — | G8 | — | — |

Esforço M. Riscos: `KpiTile` faixa é compartilhado com Expedição e `CxResumo`; mudar só as chamadas da DRE. Sem anterior nem série o ganho é visual + clique para detalhe. Cuidar de `DreResumo.tsx:92` (Classificação com chips) e de `tom="ausente"`, que a variante com identidade talvez não trate igual.

### Monitoramento de preços (`app/monitoramento-preco/page.tsx`) — rota não tematizada

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 6 KPIs (`kpiViews`) | `page.tsx:797-820` | `<button>` `bg-white border-violet-100 rounded-2xl`; **o clique filtra a tabela** | G1 G2 G3 G7 (`ativo` + `acaoFalada="ver na fila"` do `KpiTile` existem para isso) | contagem sim; anterior/série sem dado | P0 |
| KPIs de qualidade (`qualidadeViews`) | `page.tsx:821-850` | botão `bg-slate-50` | G1 G2 G3 G7 | sem dado | P1 |
| Carregando | `page.tsx:789, 758, 889, 1134` | blocos `animate-pulse` slate | G9 | — | P1 |
| Erro/vazio | `page.tsx:~1116, 1157, 1188` | botões e textos soltos | G10 | — | P1 |
| Drilldown do anúncio | `page.tsx:1327, 1370-1523` | `KpiDrilldownDialog` + `Drilldown*` | **ok** | sim | ok |
| Frescor (4 relógios), causas de ausência | `page.tsx:767-788`, `855-~960` | `<dl>`, barras | informativo | — | P2 |

Esforço M. Riscos: página de 1526 linhas; os KPIs filtram, não abrem modal (manter o comportamento); canal sem publicação mostra `INDISPONIVEL` (`:812`), não zero.

### Monitoramento · Revendedores (`app/monitoramento-preco/revendedores/RevendedoresClient.tsx`) — atrás de flag

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| 5–6 KPIs (Anúncios, Violação PMA, Sellers violando, Desvio médio, Buy box, Sellers identificados) | `RevendedoresClient.tsx:416-460` (`FaixaKpis`) | `StatCard` | G1 G2 (cinza) G7 G8 G9 (`StatCard` tem `carregando`, mas `FaixaKpis` não usa) | valor sim; anterior/série sem dado; sem dado para detalhe além de contagens | P0 |
| Severidade, tabelas, estados | `:462`, `:310-410`, `:133,135,306,315` | `Panel`, `StateBlock` | ok | — | ok |

Esforço P. Riscos: rota atrás de flag, difícil validar visualmente; `StatCard` é compartilhado (trocar o uso).

### Criadores + Alertas (`app/operacoes/page.tsx`, 850 linhas) — rota não tematizada, 100% literais

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Faixa de KPIs | não existe | — | definir o que vira cartão padrão (candidatos: Velocidade ML, Alertas) | — | P0 |
| Alertas críticos e de atenção | `page.tsx:~372-436` | `div bg-rose-50`/`bg-amber-50` sem clique | G1 G2 G7 G8 | `mensagem`, `brand`, `ad_spend`/`roas`; sem detalhe extra | P1 |
| Velocidade ML (3 cartões por marca) | `page.tsx:698-778` | `div bg-white rounded-2xl p-5`, 2 colunas de métricas | G1 G2 G3 G7 G8 | valor por marca sim; anterior/série sem dado | P1 |
| Carregando | `page.tsx:~325` | `opacity-50` + `aria-busy`, sem esqueleto | G9 | — | P1 |
| Erro/vazio | `page.tsx:332, 336-342, ~366` | `div` violeta/emerald com `<p>` | G10 | — | P1 |
| Top Criadores, Lives, Trend TikTok | `page.tsx:439-840` | tabelas e gráfico | sem KPI | série existe (é o gráfico) | P2 |
| Modal | não existe | — | G8 | — | — |

Esforço G: o P0 aqui é criar a estrutura, com decisão de produto sobre o que é o cartão. Mudança de layout grande sem dado novo.

### Performance das contas (`app/performance-contas/*`) — Server Component, atrás de flag, inerte

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Indicador por canal (rótulo, chip Oficial/Cálculo Torre, `<details>` "?", valor `text-2xl`, janela/atualizado/cobertura/limiar) | `IndicadorItem.tsx:19-104`, grade em `page.tsx:~157` | `<li> rounded-lg border-line bg-surface p-3` | G1 G2 G3 G7 G8 | valor, janela, cobertura, limiar, fonte e ajuda sim (`VisaoIndicador`, `performance-contas.ts:409`); anterior/série sem dado | P0 |
| `<details>` "?" | `IndicadorItem.tsx` | funciona sem JS | G8: `limiar`, `origem`, `fonte`, `ajuda`, `cobertura` caberiam num `DrilldownSecao` | sim | P1 |
| Carregando | `loading.tsx` | `StateBlock carregando` | G9 | — | P2 |
| Estados | `IndicadorItem.tsx:59-67`, `page.tsx:~58,~112` | `StateBlock` | ok | — | ok |

Esforço M. Riscos: **Server Component** — `KpiDrilldownDialog` pede cliente (wrapper cliente com `onAbrir`); o contrato `docs/performance_contas_contrato.md` proíbe cor de severidade no valor e exige "valor só quando o estado é `dado`"; rota inerte, difícil de testar.

### Metas (`app/metas/MetasClient.tsx`, `components/metas/*`) — tematizada

Tela de edição, sem faixa de KPIs.

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| "Meta global" | `MetasGrade.tsx:100-103` | `<td> text-lg font-bold text-accent` | virar `KpiTile` (G1–G3 G7) | `totais().global` sim; meta do mês anterior: sem dado confirmado | P1 |
| Vazio ("Nenhuma meta definida") | `MetasClient.tsx:~290` | `Note` | G10 | — | P2 |
| Carregando | `MetasClient.tsx:286` | `StateBlock` | G9 | — | P2 |
| Grade editável, meta por dia | `MetasGrade.tsx:45-108`, `MetaPorDia.tsx:58` | tabelas | formulário, não cartão | — | P2 |

Esforço P. Não mexer na grade editável nem na barra de ações fixa.

### Página de marca (`app/brand/[brand]/page.tsx`, 893 linhas) — rota não tematizada

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| GMV, Pedidos, Ticket médio, Ad Spend (+ROAS) | `page.tsx:558,559,560,562/569` | `KpiCard` legado sem `onOpenDetail`; só o GMV recebe `mom` (texto "▲ x%") | G1–G8 | **anterior existe** (`prevDaily`, `summarize(prevDaily)`, `:305, :419`; depende de `filters.compare` e do modo demo/live); **série existe** (`daily`); Ad Spend TikTok: sem dado (já mostra "—" com motivo) | P0 |
| Stats mensais (~20 itens) | `TikTokMonthlyPanel.tsx:172-294` (`Stat`, `:431`) | `div bg-slate-50 rounded-xl` | não forçar o cartão gerencial nos ~20; priorizar GMV, Pedidos, COS | anterior mensal sem dado | P1 |
| Carregando | `page.tsx:541`, `580`; `TikTokMonthlyPanel.tsx:118` | `SkeletonKpiCard` legado, `h-64 bg-slate-100` | G9 | — | P1 |
| Erro/vazio/estado do mensal | `page.tsx:~695`, `TikTokMonthlyPanel.tsx:442` | texto solto | G10 | — | P1 |
| "O que mudou" | `page.tsx:644-681` | `<li>` com texto, "Sem dado antes/agora" | G4 poderia usar `DeltaBadge` | sim | P2 |
| Detalhe de superfície e de produto | `page.tsx:806-882` | `KpiDrilldownDialog` + `Drilldown*` | **ok** | sim | ok |

Esforço M/G. Riscos: dois regimes de dado (intervalo global vs competência mensal), o rótulo de cada seção precisa ficar; modo demonstração tem série e Ad Spend inconsistentes com `ordersReliable` e a tela avisa "Dados de exemplo"; com `filters.compare` desligado, `antes`/delta somem.

### Full (`app/full/VisaoGeralFull.tsx`, `app/estoque-ml-full`, `app/estoque-full`, `app/full-ml`, `app/full-shopee`) — dono: Front · Full

`/full-ml`, `/full-shopee`, `/estoque-full` e `/estoque-ml-full` são sub-abas dentro de `/full`.

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Herói "Produtos-chave (AA/A) sem estoque" + blocos por canal | `VisaoGeralFull.tsx:556`, `175-235` | `Heroi` + botões `card-hover` | ok | delta só do total; série sem dado | ok |
| "Sem estoque com demanda", "Param a venda · Shopee" | `:592`, `:634` | `KpiTile` gerencial com delta + antes | G7 G8 (sem `onAbrir`), G6 | só há foto anterior (`buscarAnterior :~452`) | P0 |
| "Impacto potencial · ML/Shopee" | `:610` | `KpiTile` gerencial com `onAbrir`; **o clique filtra a fila** | G8 não se aplica (decisão de produto) | — | ok |
| Modal "Impacto potencial por curva ABC" | `:648-670` (aberto em `:567`), `DetalheCurva :318`, `DetalheImpacto :372` | `KpiDrilldownDialog` com conteúdo próprio | G8: sem `DrilldownSecao`, `EvidenceRow`, `DrilldownContextLine`, `DataQualityNote` (parágrafo de metodologia em `:478-480` vira `DataQualityNote`) | sim | P1 |
| Ramo "modal por canal" | `:664-669` | **inalcançável**: `setDrill` só é chamado com `"curva"` (`:567`) | ou vira modal nos cartões de impacto, ou sai | `impactoPorMarca` existe | P1 |
| 8 cards ML / 8 Shopee (estoque) | `components/full/CategoriasEstoque.tsx:33-57`, `cardsML :746-768`, `cardsShopee :691-712` | `KpiTile` gerencial com identidade, ícone, `ativo`/`aria-pressed`, `onAbrir` (filtra) | G1–G3, G7 ok; G4/G5 só com 2ª chamada (`?ref_date=`, comparação entre fotos); G6 sem dado | — | P0 |
| Carregando estoque | ML `:612`, Shopee `:542` | `<p role=status>` | G9 | — | P0 |
| Erro, indisponível, vazio por filtro | ML `:622-648`, `PainelIndisponivel :~121`; Shopee `:548-566`, `:~122` | `<section>` próprias | G10 → `StateBlock` | — | P1 |
| 8 KPIs Envio ML | `app/full-ml/FullMLClient.tsx:336-380` | `KpiCard` legado | G1–G8 | série diária real para GMV/pedidos/unidades/share (`serieDiaria`, `lib/ml-fulfillment.ts:391`); anterior sem dado | P0 |
| 8 KPIs Desempenho Shopee | `app/full-shopee/FullShopeeClient.tsx:315-334` | `KpiCard` legado | G1–G8 | `serieDiaria` existe (`lib/shopee-fbs.ts:313`); métricas cobertas: não conferido | P0 |
| Esqueletos, vazio/erro das duas | `FullMLClient.tsx:303-315, 318, 286, 295`; `FullShopeeClient.tsx:288-294, 299, 270, 282` | `h-24 bg-raised` lisos, `<p>` com borda | G9 G10 | — | P1 |

Esforço M (Visão Geral + estoques); G se incluir Envio ML e Desempenho Shopee. Riscos: **Front · Full está migrando os mesmos arquivos**; `FaixaCategorias` é compartilhada entre as duas abas de estoque; `KpiCard` legado é usado em outras rotas; "antes" nas abas de estoque custa uma 2ª chamada à API.

### Expedição (`app/expedicao/ExpedicaoClient.tsx`, `components/expedicao/*`) — dono: Front · Expedição

A visão "gestor" (padrão) já está quase toda no padrão. O resíduo está na visão "detalhe", no "Mais detalhes" e nos modais.

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Herói Vencidos / Acima de 48 h; Herói TikTok | `ExpedicaoClient.tsx:1131-1170`; `TikTokPedidosAbertos.tsx:353-385` | `Heroi` com delta, série horária, CTA | ok (série e delta somem com a divisão vendedor × FBS, de propósito, `SEM_SERIE :272`) | — | ok |
| Faixa de apoio (due_soon, over48h, stalled) | `ExpedicaoClient.tsx:1190-1243` | `KpiComAjuda` → `KpiTile` completo | G1–G8 ok; falta G9 | — | ok |
| 3 cards TikTok (Vence hoje, Vence próximo dia útil, Acima de 48 h) | `TikTokPedidosAbertos.tsx:404-415` | `KpiTile` gerencial completo, `onAbrir` só se n>0 | ok (G4–G6 sem dado) | — | ok |
| **Visão detalhe**: faixa principal e secundários (`CelulaKpi`) | `ExpedicaoClient.tsx:347-374` (usos `:1021-1025`, `:1876-1880`) | `KpiComAjuda` gerencial sem `onAbrir`, série, delta ou antes; identidade só para due_soon/over48h/stalled (`:262`) | para backlog, sem_prazo, slow, zombie, marcas_alerta, overdue, due_next_day: G1 G2 (caem em `KpiGerencial`); em todos G4–G8 | série horária existe para overdue/over48h/stalled (`:266`); lista por tipo existe (`LISTA_DO_KPI`, `abrirLista :941`) | P1 |
| "Pedido mais antigo em fila" (ML sem prazo) | `ExpedicaoClient.tsx:1232-1243` | `KpiComAjuda` identidade `pedidos` | G7 G8 G6 | `maisAntigo.marca` e `horas` existem | P1 |
| Card "LDR da janela" TikTok | `TikTokDispatchPanel.tsx:455-500` | `KpiComAjuda` completo | G7 G8 (sem clique) | popup de coleta perdida já existe | P1 |
| Modal `TravadosDialog` | `TravadosDialog.tsx:309-462` | `KpiDrilldownDialog` larga com `DrilldownSecao` (`:370-456`) e `EvidenceRow` (`:142`) | G8 parcial: faltam `DrilldownContextLine`, `DataQualityNote` (o `rodape :301` é string solta), `DrilldownCta`; estados `<p role=status>` em vez de `StateBlock compacto` (`:333-346`) | sim | P1 |
| Modal dos abertos TikTok | `TikTokPedidosAbertos.tsx:118-240` | idem | idem (estados `:132-141`) | sim | P1 |
| Modal Coleta perdida | `TikTokColetaPerdida.tsx:252-389` | idem | idem (estados `:256-268`) | sim | P1 |
| Estados da tela | `ExpedicaoClient.tsx:1804-1829`; `TikTokDispatchPanel.tsx:896-908` | `StateBlock` | G10 ok; **G9 sem esqueleto de card** | — | P1 |
| `BlocoFbs` (4), LDR Shopee (4), 4 cards da janela TikTok | `ExpedicaoClient.tsx:382-397`; `LdrShopeePanel.tsx:187-218`; `TikTokDispatchPanel.tsx:538-566` | `KpiComAjuda` gerencial sem identidade, ícone ou `onAbrir`, dentro de "Mais detalhes" | G1 G2 G4–G8 | FBS sem série por design; LDR `previous`: não conferido | P2 |
| Performance oficial; Coleta perdida (bloco); LDR "fora da taxa" | `PerformanceOficial.tsx:175,195`; `TikTokColetaPerdida.tsx:440-488`; `LdrShopeePanel.tsx:229-241` | cards e `<dl>` próprios | fora do padrão de cartão (detalhe) | — | P2 |

Esforço M. Os 3 modais são uma mudança só (`TravadosDialog` + 2 popups TikTok). Riscos: `ExpedicaoClient.tsx` tem 1893 linhas e o dono está nele; `KpiComAjuda` e `KpiTile` são compartilhados; `TravadosDialog` e `ConsolidadoEtapas` servem os dois canais.

### CX (`app/cx/*`, `components/gerencial/CxResumo.tsx`, `CxDrilldown.tsx`) — dono: Front · CX

| Card/Modal | Arquivo:linha | Hoje | Falta | Dado existe? | Prio |
|---|---|---|---|---|---|
| Herói Shopee e ML | `CxConteudo.tsx:183-207`; `CxMercadoLivre.tsx:124-155` | `Heroi` | ok | sem série | ok |
| Faixa Shopee: Contact rate, Cancelamento, Reembolso | `CxConteudo.tsx:422-470` | `KpiTile` completo (identidade, ícone, delta, antes, série, `onAbrir`, ⓘ) | ok; G9 | — | ok |
| Modal por indicador (Shopee) | `CxConteudo.tsx:249-263` → `CxDrilldown.tsx:48-103` | `Drilldown*` completo; notas em `<ul border-t>` próprio (`:92-98`) | G8 quase ok (sem `DataQualityNote`) | sim | P2 |
| **Faixa ML: Reclamação e Cancelamento** | `CxMercadoLivre.tsx:237-265` | `KpiTile` completo **sem `onAbrir`** | G7 G8 (cartão sem clique) | dado por marca existe (`prob.linhas`, `ProblemasPorMarca`) | **P0** |
| Reembolso ML | `CxMercadoLivre.tsx:269-279` | `KpiTile` ausente ("—", "Sem fonte") | ok (G10) | ML não coleta reembolso | ok |
| Modal "Saúde da Conta" por marca | `CxConteudo.tsx:381-420` (`DetalheMarca`), abre em `:249-263` e `CxMercadoLivre.tsx:218-220` | conteúdo próprio (`Chip`, `<ul>`, `<dl>`) | G8: sem `DrilldownSecao`, `EvidenceRow`, `DrilldownContextLine`, `DataQualityNote` | sim | P1 |
| Fila de atenção ML | `CxMercadoLivre.tsx:~185-195` | `FilaAtencao` sem `onAbrir` nos itens | falta clique (a Shopee tem) | provável; não conferido | P1 |
| Avaliações de produto: cards por marca | `AvaliacoesProduto.tsx:112-133` | `KpiTile` gerencial, identidade `atendimento`, ícone Star | G7 G8 (sem clique) | G4–G6 sem dado; G8: `d.produtos` tem `marca` | P1 |
| Modal "todos os produtos" | `AvaliacoesProduto.tsx:171-176` | `KpiDrilldownDialog` larga com `Segmented` + tabela | G8: sem `Drilldown*` | sim | P2 |
| `SaudePorMarca` (chips-botão no herói) | `CxConteudo.tsx:343-378` | `Chip` em `<button aria-haspopup>`, hover só de fundo | chip, não cartão (ok) | — | P2 |
| Pedidos do motivo (clique no Pareto) | `PedidosDoMotivo`, `CxConteudo.tsx:721-805` | lista **inline**, não modal; estados ok | decisão: manter inline ou migrar | sim | P2 |
| CX na Gerencial (`CxResumo`) | `CxResumo.tsx:259-306` | `KpiTile` **sem `onAbrir`, embrulhado num `<button>` externo** com `card-hover` e `aria-label` (`:251-258`) | divergência: dois controles aninhados se o `KpiTile` mudar; G9 | série e delta já usados | P2 |
| Estados | `CxConteudo.tsx:127-142`; `CxMercadoLivre.tsx:100-123`; `CxResumo.tsx:211-219` | `Heroi carregando` + `StateBlock` | G10 ok; G9 | — | P1 |

Esforço P/M. Riscos: `CxMercadoLivre` importa peças de `CxConteudo` (`COR_DELTA`, `Celula`, `DetalheMarca`, `Notas`, `SaudePorMarca`, `TD`, `TH`…) — mexer em `CxConteudo` quebra o ML; `CxResumo` e `CxDrilldown` ficam na Gerencial (referência); `DetalheMarca` é compartilhado Shopee/ML; **Front · CX está migrando**.

## 3. Resíduo transversal

1. **G9 — esqueleto de cartão.** Extrair um `ui/KpiCardSkeleton` (cópia da `KpiBand`, sem tocar nela) resolve Canais, Pedidos, Qualidade, Regiões, Produtos, Monitoramento, Operações, Marca, Full e CX de uma vez.
2. **G10 — caixas de erro/vazio feitas à mão** (`rose-50`, `border-dashed`, `<p>` soltos) em Qualidade, Pedidos, Regiões, Operações, Inteligência, Monitoramento, Produtos, Estoques e Full ML/Shopee → `StateBlock` + `RetryButton`.
3. **Peças `Drilldown*` incompletas** em Afiliados, Descontos, Full (curva), Expedição (3 modais), CX (`DetalheMarca`, Avaliações): faltam `DrilldownContextLine`, `DataQualityNote`, `DrilldownCta`, `EvidenceRow`.
4. **Cartão que filtra vs. cartão que abre modal.** Pareto de Produtos, KPIs de Monitoramento, cartões do Full e estoques filtram; o `KpiTile` já cobre isso (`ativo` + `acaoFalada`, `aria-pressed`). Não forçar modal onde o clique filtra.

## 4. Decisões que mudam o escopo da fase 2

1. **Identidades que faltam.** Para Canais/Financeiro (TikTok, ML, Shopee), Qualidade (cancelamento, devolução, entrega), Produtos (curva A/B/C/D) e Operações. Recomendação: reusar as 7 existentes onde o significado bate (`pedidos`, `gmv`, `ticket`, `prazo`, `atendimento`) e **não** criar token por canal, porque `canal-*` já é identidade de canal e não deve virar cor de cartão (`DESIGN.md`: "channel colours only for identity"). Canal entra como ponto no rótulo, como o `StatCard` faz.
2. **Painéis por canal do Financeiro**: opção A (painel vira botão com modal) ou B (3 `KpiTile` de GMV + painel no modal).
3. **Modal herda ícone e cor do cartão?** Hoje não (padrão, seção 12, item 1). Recomendação: sim, uma vez em `KpiDrilldownDialog`/`DrilldownSecao`, antes das abas, para o "modal no mesmo estilo" valer em todas. `KpiDrilldownDialog` está na lista de congelados da nota do canvas; precisa de aval do Revisor UX.
4. **Rotas não tematizadas** (Pedidos, Qualidade, Regiões, Produtos, Inteligência, Monitoramento, Operações, Performance, Marca): migrar para o escuro é um PR à parte por aba; os PRs de cartão mantêm o claro fixo.

## 5. Item próprio, depois das abas: o CABEÇALHO DE FILTROS varia por aba

Registrado em 10/11/2026 a pedido do usuário (observação sobre Pedidos em produção). A identidade única pede o **mesmo cabeçalho em todas as abas**: título com ícone e os seletores "Marca" e "Período" da Gerencial. Hoje, pelo código de `origin/main` (contagem de usos em cada página):

| Cabeçalho | Onde | Componentes |
|---|---|---|
| **Gerencial** (referência): título com ícone + seletores "Marca" e "Período" + canais em segmentado | `/`, `/canais`, `/financeiro`, `/cx` (via `FiltrosCx`) | `PageHeader`/`GerencialHeader` + `layout/GlobalFilterControls` |
| **Fileira de abas** (Todas/ÁPICE/BARBOURS…, Hoje/7 dias/…, datas De/Até) | `/pedidos`, `/qualidade`, `/regioes`, `/brand/[brand]` (sem marca) | `PageHeader` + `MarketplaceFilter` + `BrandFilter` + `DateRangeFilter` (variante "faixa") |
| Outros (a levantar no PR de cabeçalho): `/produtos`, `/dre`, `/inteligencia`, `/monitoramento-preco`, `/operacoes`, `/metas`, `/full`, `/expedicao`, `/marcas-menores`, `/performance-contas` | — | filtros próprios ou nenhum; não usam `GlobalFilterControls` |

**Proposta:** um PR de cabeçalho **depois** das abas de cartões, uma aba por commit (ou um PR por grupo): trocar a fileira de abas por `GlobalFilterControls` em Pedidos, Qualidade, Regiões e Marca (o hook `useGlobalFilters` já é o mesmo), e decidir, aba a aba, o que as demais mostram. Cuidados: a fonte de Pedidos não cobre Shopee (o seletor de canais precisa continuar sinalizando isso), Regiões tem filtro local de UF, e Marca fixa a marca pela rota. O escuro de cada aba é um PR à parte; o do cabeçalho pode andar junto com ele, já que a fileira legada usa a paleta antiga.
