# Identidade da Gerencial — o padrão que toda aba segue

> Extraído do código de `origin/main` em 10/11/2026 (commit `e56338a`). Cada item
> cita arquivo e componente; nada aqui é desenho novo. Onde o código e o
> `DESIGN.md` divergem, está na seção 12. O inventário das abas fora do padrão
> está em `docs/INVENTARIO_IDENTIDADE_ABAS.md`.
>
> Caminhos relativos a `apps/web/`. `globals.css` = `app/globals.css`.

## 0. O cartão em uma frase

Vidro fosco branco/violeta, borda e brilho de canto na **cor de identidade** do
indicador, ladrilho de ícone no canto, valor grande que "conta" até o número,
pílula de variação + "antes X", mini gráfico com ponto final; o cartão é um
botão que sobe 2 px no hover e abre o modal único da página.

Componente de referência: `KpiCard` dentro de `src/components/gerencial/KpiBand.tsx`.
Versão reutilizável (mesmas classes): `KpiTile` com `variante="gerencial"` +
`identidade` em `src/components/ui/KpiTile.tsx` (função interna `KpiCardIdentidade`).

## 1. Anatomia do cartão (de cima para baixo)

| # | Peça | Classes / valor | Onde |
|---|---|---|---|
| 1 | Container | `button` (ou `div` sem clique), `w-full min-w-0 h-full text-left bg-surface border rounded-xl p-3.5 flex flex-col gap-1` + borda de identidade | `KpiBand.tsx` `KpiCard`; `KpiTile.tsx` `KpiCardIdentidade` |
| 2 | Rótulo | `text-xs font-semibold uppercase tracking-wide text-ink-faint`; ⓘ (`InfoDica emControle`) colado nele | idem |
| 3 | Ladrilho de ícone (canto sup. direito) | `h-8 w-8 rounded-lg`, fundo `bg-kpi-*/10`, ícone `h-4 w-4` stroke `1.75` na cor `text-kpi-*` | idem |
| 4 | Valor | `text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl font-semibold tracking-tight tabular-nums leading-tight`; em texto passa por `NumeroAnimado` | idem |
| 5 | Rodapé (`mt-auto flex items-end justify-between gap-3 pt-1`) | esquerda: `DeltaBadge` + `antes X` (`text-xs text-ink-faint tabular-nums`); direita: mini gráfico | idem |
| 6 | Comparação extra | `text-xs text-ink-faint leading-snug`, só quando não há delta/antes | `KpiTile.tsx` |
| 7 | Texto para leitor de tela | `<span class="sr-only"> (abrir decomposição)</span>` dentro do rótulo; o botão não tem `aria-label` (o nome acessível é o conteúdo) | `KpiBand.tsx`; `KpiTile.tsx` (`acaoFalada`) |

Regras de ausência (valem no `KpiTile` e na `KpiBand`):

- sem período anterior real → sem `DeltaBadge` e sem "antes";
- sem série real (≥ 4 pontos) → sem mini gráfico (`KpiTile`: `t.pontos.length >= 4`);
- sem valor → `N/D` em `text-ink-faint` (`KpiBand.tsx`); ausência nunca vira zero;
- caveat/metodologia → ⓘ (`InfoDica`), nunca linha de texto no cartão.

## 2. Cor de identidade e gradiente

Tokens `--tc-kpi-*` em `globals.css` (claro → escuro), expostos no Tailwind como
`kpi.*` (`tailwind.config.ts`):

| Identidade | Claro (RGB) | Escuro (RGB) | Ícone na `KpiBand` | Borda |
|---|---|---|---|---|
| `gmv` | 109 40 217 | 167 139 250 | `CircleDollarSign` | `border-kpi-gmv/30` |
| `pedidos` | 194 106 5 | 251 191 36 | `ShoppingBag` | `border-kpi-pedidos/35` |
| `ticket` | 79 70 229 | 129 140 248 | `Receipt` | `border-kpi-ticket/30` |
| `ads` | 192 38 211 | 232 121 249 | `Megaphone` | `border-kpi-ads/30` |
| `roas` | 5 150 105 | 52 211 153 | `Gauge` | `border-kpi-roas/35` |
| `prazo` | 37 99 235 | 96 165 250 | (definido pelo consumidor) | `border-kpi-prazo/30` |
| `atendimento` | 15 118 110 | 45 212 191 | (definido pelo consumidor) | `border-kpi-atendimento/35` |

- **Identidade nas outras abas (sem cor nova, decisão de 10/11/2026):** só as 7 acima; o canal (TikTok/ML/Shopee) é um ponto `bg-canal-*` antes do rótulo, nunca cor de cartão. Em Canais (`components/canais/CartaoKpiCanal.tsx`): mix de GMV (vídeo, live, card) → `gmv`; novos compradores e recompra → `pedidos`; GMV por comprador → `ticket`; visitantes → `atendimento`; conversão → `roas`. Modais dos painéis de Canais (`AffiliateCostsPanel`, `TiktokOrderDiscountsPanel`): Afiliados → `Handshake` + `ads`; Descontos → `BadgePercent` + `ticket`. Esses dois blocos mostram valor contábil **por extenso** ("R$ 48.210,37"), de propósito: valor abreviado não reconcilia com relatório.
- **Pedidos** (`components/pedidos/PedidosCartoes.tsx`): total de pedidos → `pedidos`; GMV → `gmv`; ticket → `ticket`; cancelamento e cancelados → `atendimento` (tom pela regra existente: <2% bom, <5% atenção, senão crítico); entregues → `prazo`. O canal é o ponto no título do grupo. Só pedidos e cancelados por canal abrem detalhe (só eles têm dado por marca); GMV e entregues por canal são cartões sem clique.
- **Qualidade** (`components/qualidade/QualidadeCartoes.tsx`): entrega (dias) → `prazo`; cancelamento, não entregue e devolução → `atendimento`, todos em tom neutro (a tela nunca teve regra de severidade nos cartões). Um grupo por canal, com o ponto do canal no título. Os cartões "N/D" do TikTok (Gate DQ2) seguem explícitos, sem clique.
- **Ações ML + TikTok** (`components/inteligencia/PriorityCards.tsx`): desperdício de Ads → `ads`+`OctagonX`; oportunidade de escala → `roas`+`Rocket`; teste orgânico → `gmv`+`FlaskConical`. Identidade, não estado: o que cada prioridade significa está no título. O detalhe (já no padrão) herda ícone e cor do cartão.
- Rodapé do cartão com identidade (`KpiTile`): `flex-wrap`, para o gráfico passar para a linha de baixo em cartão estreito (390 px, 2 colunas) em vez de sair da caixa.
- Mapa identidade → classes: `IDENTIDADE` em `KpiTile.tsx` (tipo `IdentidadeKpi`);
  mapa KPI → ícone + classes: `ICONE_KPI` em `KpiBand.tsx`. As classes são
  literais para o Tailwind enxergar.
- A cor **não diz bom ou ruim**. Estado fica no `DeltaBadge` e na tinta do valor
  (`TOM_TINTA`, `ui/tone.ts`).
- **Gradiente do cartão** = brilho radial no canto inferior direito na cor do KPI.
  Vem do CSS, não do componente: o seletor `[class*="border-kpi-X"]` define
  `--kpi-cor` e `.rounded-xl.border.bg-surface[class*="border-kpi-"]` pinta
  `radial-gradient(16rem 11rem at 100% 100%, rgb(var(--kpi-cor) / 0.16), transparent 70%)`
  (`0.22` no escuro). `globals.css`, bloco "UX-VIDRO-2" (~L661–682).
  **Consequência:** só ganha o gradiente quem usa a classe `border-kpi-*` num
  elemento `.rounded-xl.border.bg-surface`.
- Variante sem identidade (`KpiGerencial` em `KpiTile.tsx`): borda `border-line`,
  ladrilho `h-7 w-7 bg-accent/10 text-accent`, valor `text-2xl`, sem brilho.
  É o "neutro", não o padrão da Gerencial.
- Brilho por **tom** (risco) em vez de identidade: `tc-brilho-crit | warn | neutro`
  e `tc-brilho-forte` (`globals.css` "UX-VIDRO-4", ~L716–733). Usado por cartões
  de risco/herói, não pelo cartão de KPI.

## 3. Vidro, raio e sombra em repouso

`globals.css`, bloco "UX-VIDRO-1" (~L501–585). Vale para todo
`.rounded-xl.border.bg-surface` (Panel, StatCard, KpiTile, cartões da Gerencial):

- fundo `rgb(var(--tc-vidro) / 0.7)` (`0.62` no escuro); `--tc-vidro` = 255 255 255 (claro) / 34 24 74 (escuro);
- `border-radius: 1rem` (o `rounded-xl` do Tailwind vira 16 px);
- sombra em repouso: `inset 0 1px 0 rgb(255 255 255/.55)`, `0 1px 2px rgb(49 24 110/.05)`, `0 14px 34px -20px rgb(76 29 149/.3)` (escuro: realce `.06` e `0 18px 40px -20px rgb(0 0 0/.6)`);
- `backdrop-filter: blur(18px) saturate(150%)`; sem suporte, volta a `--tc-surface` opaco;
- só a borda **neutra** (`border-line`) vira `--tc-vidro-borda / .16` (`.18` escuro); borda `border-kpi-*` e de estado ficam como estão;
- menu flutuante e diálogo: `--tc-surface / .96` (quase opaco, lê sobre conteúdo).

Tokens de superfície (`globals.css` L20–150; também em `DESIGN.md` §7):

| Papel | Claro | Escuro |
|---|---|---|
| canvas `--tc-canvas` | 241 237 252 | 13 8 34 |
| surface `--tc-surface` | 255 255 255 | 30 21 64 |
| raised `--tc-raised` | 244 242 251 | 41 30 82 |
| line / line-strong | 231 227 245 / 214 208 236 | 56 44 98 / 76 62 128 |
| ink / muted / faint | 23 18 38 / 82 76 103 / 108 101 130 | 242 239 250 / 184 176 208 / 150 141 178 |
| accent / accent-ink | 109 40 217 / 76 29 149 | 167 139 250 / 221 210 254 |
| ok / ok-soft / ok-ink | 5 150 105 / 232 247 240 / 5 96 62 | 52 211 153 / 16 40 31 / 110 231 183 |
| warn / warn-soft / warn-ink | 194 106 5 / 253 243 227 / 138 71 8 | 251 191 36 / 43 31 7 / 252 211 77 |
| crit / crit-soft / crit-ink | 225 29 72 / 253 234 238 / 159 18 57 | 251 113 133 / 44 15 24 / 253 164 175 |

Fundo da página: três halos radiais fixos (`.tc-fundo`, `--tc-brilho-1..3`, `--halo` 1,45 claro / 1 escuro).

## 4. Tipografia

- Família: DM Sans (`--font-sans`, `app/layout.tsx`); tabelas usam Inter (`--font-num`) porque a DM Sans não tem `tnum`.
- Rótulo do cartão: `text-xs` (12 px) / 600 / uppercase / `tracking-wide`, `text-ink-faint`.
- Valor do cartão: escala responsiva da seção 1 (item 4), `font-semibold tracking-tight tabular-nums leading-tight`.
- Valor do herói (`MetaHero`, `ui/Heroi`): `text-3xl font-bold tracking-tight tabular-nums`.
- Valor no modal (`KpiDrilldownContent`): `text-[32px] font-bold leading-none tracking-tight tabular-nums`.
- Piso de 12 px em tudo (`DESIGN.md` §3).

## 5. Pílula de variação e "antes"

- `DeltaBadge` (`src/components/ui/DeltaBadge.tsx`): `inline-flex w-fit items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums`; seta `ArrowUpRight`/`ArrowDownRight` `h-3.5 w-3.5` stroke `2.25`; texto de `fmtDelta(pct, unidade)` (`pct` | `pp` | `pts`).
- Cores: `bg-ok-soft text-ok-ink` (melhorou), `bg-crit-soft text-crit-ink` (piorou), `bg-raised text-ink-muted` (`tone="neutral"`, sem juízo). `lower_is_better` inverte a cor, nunca o número.
- "antes X": texto `text-xs text-ink-faint tabular-nums` ao lado da pílula; vem de `reference` em `src/lib/gerencial/kpi-band.ts` (`"antes " + valor`), só quando há período anterior real.
- Variações do mesmo desenho que **não** reusam o componente (3 cópias do markup): `KpiReference` em `KpiDrilldownContent.tsx` (`px-2 py-0.5 text-sm`, seta `h-4`), `EvidenceRow.tsx` (`h-3` seta) e a lista por canal do ROAS na `KpiBand` (texto `▲/▼ de X`).

## 6. Mini gráfico (sparkline) e ponto final

`src/components/ui/Sparkline.tsx` (`Sparkline` + `LinhaDeTendencia`), lógica em `src/lib/gerencial/kpi-trend.ts`.

- Só existe com **≥ 4 pontos reais** (`tendencia()` devolve `null` abaixo disso); pontos nulos/não finitos são descartados.
- A linha é a série **suavizada**: média móvel de 7 pontos quando há ≥ 14 (`suavizar`); com menos, a série crua.
- Janela de comparação do `title`/`sr-only`: últimos 7 vs 7 anteriores (ou metade vs metade em séries curtas); rótulo "últimos N dias vs N anteriores" (`hour` → "últimas N horas").
- Cauda sem venda é cortada antes do cálculo (`totaisDaSerie`) — o "hoje" zerado não puxa a tendência para baixo.
- Desenho: SVG `viewBox 0 0 100 32`, `preserveAspectRatio="none"`, linha `strokeWidth 2` `vectorEffect non-scaling-stroke`, área em degradê vertical da cor do KPI (`stopOpacity .32 → 0`), tudo em `currentColor` (a cor vem de `text-kpi-*`).
- Série constante fica no **meio** (`y = 16`), nunca colada no chão.
- Ponto final: `<span>` separado (fora do SVG esticado) `h-2 w-2 rounded-full bg-current ring-2 ring-surface`, posicionado em `top = último y`.
- Largura: `w-24`, `min-[1440px]:w-28`, `shrink-0`; altura `h-9`.
- Acessibilidade: SVG `aria-hidden`; `sr-only` "Tendência: tende a subir/descer/estável"; `title` com "últimos 7 dias vs 7 anteriores: +x,x%".

## 7. Hover, foco, ativo, desabilitado

Regra `.card-hover` (`globals.css` ~L223–255), aplicada em botões-cartão (`KpiBand`, `KpiTile` com `onAbrir`, `CxResumo`, `app/full/VisaoGeralFull.tsx`):

| Estado | Efeito |
|---|---|
| repouso | `transition: transform 220ms cubic-bezier(.2,.8,.2,1), box-shadow 220ms (mesma curva), border-color 220ms ease` |
| hover (só `@media (hover: hover)`) | `translateY(-2px)` + sombra `0 18px 36px -18px rgb(accent/.45)`, `0 12px 24px -14px rgb(0 0 0/.35)`, `0 2px 6px rgb(0 0 0/.06)` |
| pressionado (`:active`) | `translateY(0)`, `transition-duration: 80ms` |
| `prefers-reduced-motion` | sem `transform`; só `box-shadow 120ms` |
| foco por teclado | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent` no cartão; foco global `:focus-visible { outline: 2px solid accent; offset 2px }` |
| alvo de toque | `min-h-11` (44 px) |
| ativo (cartão que filtra) | `KpiTile`: `ativo` → `aria-pressed` + `ring-2 ring-accent` (abas de estoque do Full) |
| desabilitado | não existe no cartão. Ausência é `div` sem clique (`KpiTile` sem `onAbrir`) ou `N/D`; `ausente` em `tone.ts` = borda tracejada `border-dashed` |
| ARIA | clique que abre modal: `aria-haspopup="dialog"`; clique que filtra: `aria-pressed`; outra ação: `acaoFalada` no `sr-only` |

O que anima **dentro** do cartão no hover (classe `group` no cartão):

- ladrilho do ícone: `group-hover:scale-110`, `transition-transform duration-200 ease-out`, `motion-reduce:transition-none motion-reduce:group-hover:scale-100` (`KpiBand`, `KpiTile`);
- nada mais (nem valor, nem gráfico).

Outros hovers do mesmo vocabulário:

- linha de tabela: `tbody tr:hover` → `bg-raised/.7`, `transition background-color 120ms` (`globals.css`);
- seta do CTA do modal: `group-hover:translate-x-0.5`, 200 ms (`DrilldownCta.tsx`);
- nome da marca em `MarcasMeta.tsx`: `group-hover:translate-x-0.5`, 200 ms;
- ⓘ: `hover:text-ink-muted`, balão no hover/foco (`InfoDica.tsx`).

## 8. Movimento (curva, durações, o que anima)

`globals.css`, bloco "ANIMACOES-1" (~L318–500). **Uma curva e três durações:**
`--mov-ease: cubic-bezier(.2,.8,.2,1)`, `--mov-rapido: 120ms` (hover, cor),
`--mov-base: 200ms` (abre/fecha), `--mov-lento: 320ms` (entra). Só `transform` e
`opacity` animam; nada repete em loop além do esqueleto e do "ao vivo".

| Animação | Valor | Onde |
|---|---|---|
| entrada da rota | `tc-entra` 320 ms (`translateY(6px)` + fade), cada filho do topo 45 ms depois do anterior (até 270 ms) | `.tc-entrada`, aplicada por `app/template.tsx` |
| número "assenta" | conta de 0 ao valor em 650 ms na montagem e do valor anterior ao novo em 450 ms ao trocar filtro; ease-out cúbica `1-(1-t)^3`; só anima o 1º número do texto e só se prefixo/sufixo não mudam (mil → mi troca direto); leitor de tela lê o valor final | `ui/NumeroAnimado.tsx` |
| mini gráfico | revela da esquerda para a direita em 800 ms (`tc-revela`, `clip-path`); ponto final entra com `tc-fade 240ms` atrasado 700 ms | `Sparkline.tsx`, `.tc-revela` |
| barras de proporção | enchem da esquerda em 600 ms (`tc-barra`); largura desliza em 500 ms | `.tc-barra` (`EvidenceRow`, `MetaHero`) |
| esqueleto | brilho que atravessa da esquerda para a direita, 1,4 s linear em loop, nos blocos `bg-raised`/`bg-line` dentro de `animate-pulse` | `.animate-pulse :is(.bg-raised,.bg-line)` |
| balão do ⓘ | `dica-entra` 160 ms | `InfoDica.tsx` |
| clique | `.tc-pressiona`: `scale(.97)` em `:active` | `globals.css` |
| "ao vivo" | anel `tc-ping` 1,6 s em loop | `.tc-ping` |
| reduced motion | regra global zera durações (`0.01ms`) e `.tc-entrada`, `.tc-barra`, `.tc-revela`, `.tc-ping` ficam sem animação | `globals.css` (L306, L491) |

## 9. Modal de detalhe (clique no cartão)

Shell único: `src/components/KpiDrilldownDialog.tsx`. **Não existe um modal por
KPI**; a página guarda um `DialogView` (`app/page.tsx`) e troca só o conteúdo.

- Portal em `document.body`; ao abrir: foco no botão de fechar, `#app-shell-root` recebe `inert`, `body` ganha `overflow: hidden`; ao fechar devolve o foco ao cartão que abriu.
- Fecha com `Esc`, clique fora do painel e botão "Fechar detalhes"; Tab fica preso no painel (`lib/focus-trap.ts`).
- Véu: `bg-[rgb(0_0_0/0.45)]`, entra com `tc-fade 200ms`. Neutro nos dois temas.
- Painel: `bg-surface w-full sm:max-w-lg` (`largura="larga"` → `sm:max-w-4xl`), `sm:rounded-2xl shadow-xl`, `h-[92vh] sm:h-auto sm:max-h-[85vh]`, `flex flex-col overflow-hidden`; entrada `tc-sobe 320ms` (`translateY(16px) scale(.98)` → normal). No mobile ancora embaixo (`items-end`), no desktop centraliza.
- Cabeçalho: `px-5 py-4 border-b border-line`; título `h2 text-sm font-bold text-ink`; botão fechar `w-8 h-8 rounded-lg`, hover `bg-accent-soft text-accent`. Com as props `icone` + `identidade`, o título ganha antes o ladrilho do cartão que abriu o detalhe (`h-8 w-8 rounded-lg`, `bg-kpi-*/10` e `text-kpi-*`, as classes de `IDENTIDADE` em `KpiTile.tsx`). Sem as props, o cabeçalho é o de antes.
- Corpo: `px-5 py-4 flex flex-col gap-4 overflow-y-auto`.
- Fundo do painel quase opaco: `[role="dialog"].bg-surface { rgb(surface/.96) }`.
- Rota ainda não tematizada: o portal herda `CLASSE_TEMA_CLARO_FIXO` (`lib/theme.ts`).

Receita do conteúdo (peças em `src/components/drilldown/`; exemplo completo:
`src/components/KpiDrilldownContent.tsx`; outros 10 conteúdos em
`gerencial/GerencialDrilldowns.tsx`):

1. **Topo**: valor exato em `text-[32px] font-bold` (`NumeroAnimado`) + pílula de variação + `vs {antes} no período anterior` (`KpiReference`).
2. **Contexto em selos**: `DrilldownContextLine` — período (`rounded-full border bg-raised`), "Atualizado …" (`rounded-full border`), e opcional selo `bg-accent-soft text-accent-ink` ("Dia em andamento"). ⓘ (`InfoDica`) ao lado, só quando muda a leitura do número.
3. **Tendência** (só com ≥ 4 pontos): `DrilldownSecao titulo="Tendência"` com o mesmo `Sparkline` do cartão (cor `text-kpi-*` da identidade, degradê, ponto final), `h-16` dado por fora (`[&>span]:h-16`). Sem `identidade`, `text-accent`.
4. **Seções**: `DrilldownSecao` — `border-t border-line pt-3`, título `text-xs font-semibold uppercase tracking-wide text-ink-faint`, ação à direita (contagem, selo, ⓘ).
5. **Linhas de evidência**: `EvidenceRow` — rótulo à esquerda, valor à direita `tabular-nums`, ponto de identidade de canal (`bg-canal-*`), pílula de variação, barra de participação `h-1.5 rounded-full bg-raised` + `tc-barra`; ausente = "Sem dado" (`tone="muted"`).
6. **Ressalva**: `DataQualityNote` — uma linha `text-xs text-warn-ink` com ponto `bg-warn`; `null` não renderiza nada.
7. **Saída**: `DrilldownCta` — linha inteira `min-h-11 rounded-xl border border-line text-sm font-semibold text-accent`, hover `border-accent/40 bg-accent-soft/50`, seta que avança 2 px.
8. **Métrica × referência nomeada** (quando há): `DrilldownMetricPair`.

## 10. Estados (vazio, carregando, erro, ausente)

- **Carregando do cartão**: `KpiCardSkeleton` em `KpiBand.tsx` — `h-full bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 animate-pulse`, `role="status" aria-busy`, três barras `bg-raised` (rótulo 3×20, valor 7×32, rodapé 3×24 em `mt-auto`), `sr-only "Carregando indicador…"`. Outros esqueletos: `ui/StatCard.tsx` (`carregando`), `components/Skeleton.tsx` (`SkeletonKpiCard`, `SkeletonTableRows`).
- **Erro do bloco**: a `KpiBand` troca a faixa por `bg-raised border border-line rounded-xl p-4` com título, uma frase do que fica indisponível e botão "Tentar novamente" `min-h-11`; cada bloco falha sozinho (sem gate global).
- **Quatro estados distintos** (`ui/StateBlock.tsx`): `vazio` (fonte respondeu, sem linha), `carregando` (ícone girando), `erro` (`border-crit/35 bg-crit-soft`, `role="alert"`, `RetryButton`), `indisponivel` (`border-dashed`, não é falha nem zero). `compacto` dentro de painel.
- **Ausência**: `N/D` ou "—" com motivo (`title` + `sr-only`), `Tom "ausente"` = `border-dashed` + valor `text-ink-faint` (`ui/tone.ts`). Nunca zero.
- **Frescor**: escrito ("Desatualizada") e visível sem hover (`ui/Freshness.tsx`, `ui/Chip.tsx`).

## 11. Ⓘ, selos e demais peças reutilizáveis

- `InfoDica` (`ui/InfoDica.tsx`): ícone `Info h-3.5 w-3.5` stroke 2, `text-ink-faint`. Modo padrão: focável, balão por portal (`fixed z-50 rounded-xl border border-line bg-surface px-4 py-3`, largura 320 px, abre abaixo e vira para cima sem espaço, fecha no scroll/Esc), corpo `text-sm`, `titulo` em negrito e `nota` pequena embaixo. Modo `emControle`: dentro de botão, só `title` + `cursor-help`.
- `Chip` (`ui/Chip.tsx`): `rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset`, tons de `TOM_SELO`.
- `Heroi` (`ui/Heroi.tsx`) e `MetaHero` (`gerencial/MetaHero.tsx`): `rounded-xl border border-accent/30` (MetaHero: `border-kpi-gmv/30`), grade `lg:grid-cols-[minmax(220px,1fr)_2fr_auto]`, selo `rounded-full border px-3 py-1.5 text-xs font-bold uppercase`.
- `Panel` (`ui/Panel.tsx`): `rounded-xl border border-line bg-surface`, cabeçalho `px-4 py-2.5 border-b`, título `text-sm font-semibold`, sem metodologia na tela.
- `FilaAtencao`, `MaisDetalhes` (`ui/`): fila com selo de severidade e `<details>` "Mais detalhes".
- Tons de estado: `ui/tone.ts` (`TOM_SUPERFICIE`, `TOM_TINTA`, `TOM_PONTO`, `TOM_SELO`).

Ritmo da página (`app/page.tsx`): container `px-4 py-4 flex flex-col gap-3`;
faixa de KPIs em `grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3`
(4 colunas sem GMV: `grid-cols-2 xl:grid-cols-4`); 2ª dobra `grid-cols-1 lg:grid-cols-12 gap-3`.

## 12. Onde o próprio padrão está inconsistente (a decidir antes da fase 2)

Estes pontos não são bug de aba; são divergências dentro do padrão. Cada um
afeta o que "replicar" quer dizer.

1. ~~O modal não herda a identidade do cartão.~~ **Resolvido no PR 0 da fase 2** (aprovado em 10/11/2026): `KpiDrilldownDialog` ganhou `icone` + `identidade` opcionais, e o gráfico de Tendência do modal passou a usar o `Sparkline` do cartão, com cor do KPI e ponto final. O mapa dos 5 KPIs da Gerencial está em `src/lib/gerencial/kpi-identidade.ts`. Cada aba passa as duas props ao abrir o modal do seu cartão.
2. **Pílula de variação em 3 cópias** (`DeltaBadge`, `KpiReference`, `EvidenceRow`), com tamanhos diferentes (ícone 14/16/12 px, `text-xs`/`text-sm`).
3. **`card-hover` só em 4 consumidores** (`KpiBand`, `KpiTile`, `CxResumo`, `app/full/VisaoGeralFull.tsx`). Cartões clicáveis das outras abas e os da própria Gerencial que não são KPI (matriz, movimentos, saúde do volume) não têm o mesmo hover.
4. **O brilho de canto depende de uma classe `border-kpi-*`** num `.rounded-xl.border.bg-surface`. Um cartão que use cor de identidade por `style` ou por `bg-*` não ganha o gradiente.
5. **`KpiTile` sem `identidade`** cai na variante neutra (`KpiGerencial`: ladrilho `h-7`, `bg-accent/10`, sem brilho, `text-2xl` fixo) — visualmente diferente do cartão da `KpiBand` (`h-8`, cor de identidade, escala responsiva). O padrão de verdade é `variante="gerencial"` **com** `identidade`.
6. **Escala do valor** `text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl` está copiada em dois arquivos (`KpiBand.tsx`, `KpiTile.tsx`); mudar um e esquecer o outro quebra a igualdade.
7. **`DESIGN.md` está defasado** em relação ao código: diz ladrilho de 28 px (código: `h-8 w-8` = 32 px), raio de painel 12 px (o vidro impõe 16 px), `kpi-pedidos: #d97706` (código: `194 106 5`, ou seja `#c26a05`), "sem sombra em painel estático" (o vidro tem sombra em repouso), e não lista `prazo` nem `atendimento` entre as identidades. Atualizar o `DESIGN.md` não faz parte deste PR.
8. **Esqueleto**: a `KpiBand` tem `KpiCardSkeleton`; `StatCard`, `Skeleton.tsx` e os de cada aba têm formatos próprios. Não há esqueleto compartilhado no formato do cartão com ícone e rodapé.

## 13. Checklist para o PR de cada aba

Um cartão está "no padrão" quando responde sim a tudo que o dado permite:

- [ ] `KpiTile variante="gerencial"` com `identidade` e `icone` (ou componente equivalente com as mesmas classes)
- [ ] valor em `NumeroAnimado` (texto já formatado, `tabular-nums`)
- [ ] `DeltaBadge` + `antes X` **só** com período anterior real
- [ ] `serie` com ≥ 4 pontos reais, senão sem gráfico
- [ ] `onAbrir` → botão com `card-hover`, `aria-haspopup="dialog"`, `min-h-11`, anel de foco
- [ ] clique abre `KpiDrilldownDialog` com `DrilldownSecao`/`EvidenceRow`/`DataQualityNote`/`DrilldownCta`
- [ ] ressalva no ⓘ (`InfoDica emControle` dentro do botão), nenhuma legenda no cartão
- [ ] esqueleto no formato do cartão; erro com "Tentar novamente"; ausência `N/D`/"—" com motivo
- [ ] igual em 1440, 390 (sem rolagem horizontal) e escuro
