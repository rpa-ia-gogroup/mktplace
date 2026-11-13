---
name: Torre de Controle — GoBeauté
description: Internal marketplace control tower for the GoBeauté brands across TikTok Shop, Mercado Livre and Shopee.
colors:
  shell: "#12112b"
  shell-raised: "#1e1c40"
  shell-line: "#28254e"
  shell-ink: "#f0eefc"
  shell-muted: "#aaa6ce"
  shell-accent: "#a78bfa"
  canvas: "#f1edfc"
  surface: "#ffffff"
  raised: "#f4f2fb"
  line: "#e7e3f5"
  line-strong: "#d6d0ec"
  ink: "#171226"
  ink-muted: "#524c67"
  ink-faint: "#6c6582"
  accent: "#6d28d9"
  accent-soft: "#f1ecfe"
  ok: "#059669"
  warn: "#d97706"
  crit: "#e11d48"
  canal-tiktok: "#8b5cf6"
  canal-ml: "#06b6d4"
  canal-shopee: "#f97316"
  kpi-gmv: "#6d28d9"
  kpi-pedidos: "#d97706"
  kpi-ticket: "#4f46e5"
  kpi-ads: "#c026d3"
  kpi-roas: "#059669"
typography:
  label:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  data:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  title:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  headline:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  kpi:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  kpi-hero:
    fontFamily: "'DM Sans', -apple-system, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  control: "8px"
  panel: "16px"
  full: "9999px"
spacing:
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  sidebar:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.shell-muted}"
    width: "240px expanded / 64px rail"
  nav-item-active:
    backgroundColor: "linear-gradient(90deg, #8b5cf6, #a78bfa)"
    textColor: "{colors.shell-ink}"
    indicator: "{colors.shell-accent}"
  panel:
    backgroundColor: "rgb(255 255 255 / .74) + blur 18px"
    rounded: "{rounded.panel}"
    border: "{colors.line}"
  kpi-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "16px"
  filter-trigger:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    height: "44px"
---

# Design System: Torre de Controle — GoBeauté

> Revised in **UX-TORRE-B2B-1** (13/10/2026). Mário set the private repository
> `b2b-gogroup/torre_b2b` as the explicit finish benchmark and approved a
> **navy operational shell** around a light data canvas. That decision replaces
> the old rule "never a dark sidebar". The benchmark audit lives in
> `docs/ux_torre_b2b_benchmark.md`.
>
> Revised again in **UX-VIDRO-1** (03/11/2026). Gabriel approved the "violet
> glass" direction from an interactive proposal: three light halos on the
> canvas, frosted-glass cards (16px radius), a navy shell with a violet glow,
> a gradient pill for the active nav item, a gradient brand mark and a
> violet-to-magenta page title, in both themes. Gradient and glow are allowed
> **only** on what is selected or identifies the screen (active nav, brand
> mark, page title, hover shadow). Data never gets a gradient. See §4.

## 1. Overview

**Creative North Star: "The instrument panel"**

The Torre reads like a flight deck, not a report. A dark navy frame holds the
navigation, identity and theme. Inside it sits a bright, dense data canvas: KPI
strip first, then wide panels with charts and tables, and depth one click away.
The category default is a stack of filter blocks, paragraphs and same-size
cards. The Torre refuses it: every viewport has to answer a question with
numbers.

What changed from the previous "Brand Observatory" direction, and why:

| Before | Now | Why |
|---|---|---|
| Light lavender sidebar | Navy shell (`--tc-shell`) in **both** themes | Mário's brief; the frame separates navigation from data at a glance |
| System font stack | **DM Sans** via `next/font` (self-hosted); **Inter only inside tables** | Rounder, friendlier figures (Torre do Atacado reference); Inter kept where R$ columns must align, since DM Sans has no `tnum` |
| 16px cards, shadow at rest | 12px panels, 1px border, shadow only on hover | Denser, quieter; the border defines the edge |
| Two-row filter bar | One row: channel segmented + brand/period triggers | First number moved up ~60px |
| Prose under titles | Chips (period, freshness) + short notes + disclosures | Warnings stay; their weight drops |
| Explanatory lines inside cards | An `ⓘ` (`InfoDica`) next to the title: `title` + `sr-only` | The number speaks first; the caveat is one hover away, never deleted |
| Neutral card borders | Each KPI has an identity colour (`--tc-kpi-*`): border, icon tile, sparkline | Find the number by colour; state colours (ok/warn/crit) stay for good/bad |
| Hover = border change | `.card-hover`: lift 2px + soft shadow, ease-out 220ms, none with reduced motion | Feels physical; tells you the card opens |

The four anti-references still hold:

- **Metabase.** The charcoal sidebar with an electric-blue accent is still
  forbidden. Navy with a violet cast and violet selection is not that.
- **Looker data dump.** Still forbidden.
- **Retool gray.** Still forbidden.
- **Excel beige.** Still forbidden.

**Key characteristics**

- Navy shell, light canvas, white panels, violet for selection and primary series only
- DM Sans for text and KPI figures; Inter (tabular) inside tables
- One icon vocabulary (`lucide-react`, 16px, stroke 1.75); the route icon repeats in the page header
- KPIs as a strip of compact cards: label, icon, number, delta pill, short note
- Status colours only behind a business rule; channel colours only for identity

## 2. Colors

### Shell (new)

`--tc-shell` is navy with a violet cast (`#12112b` light, `#0a0914` dark, one
step below the dark canvas). Text on it uses `shell-ink` (16.1:1),
`shell-muted` (7.9:1) and `shell-faint` (5.1:1, group labels only) — measured; the dark shell measures 17.4 / 8.8 / 5.5. The active
nav item is marked by three signals together: `shell-active` surface,
`shell-ink` text, and a 3px `shell-accent` bar on the left edge. Weight alone is
never the signal.

### Canvas and surfaces

The light canvas is lavender (`#f1edfc`, under three light halos). Panels are white glass with a 1px
`line` border. `raised` is the inset tone used for table heads, totals and
skeletons. The dark theme keeps its deep violet field. See §7 for every value.

### Violet discipline

Violet (`accent`) is allowed on:

- the active nav item;
- the brand mark;
- the route icon tile in the page header;
- the first data series;
- primary actions and links.

It is **not** a button fill for filter options. Active filter options use
neutral relief (`bg-surface` + `ring-line-strong`).

### Channel identity

TikTok is violet, ML is cyan, Shopee is orange. This holds everywhere: the
filter dots, charts, matrix columns and table badges. It is identity, never
quality.

### Status

`ok` / `warn` / `crit` each need a business threshold behind them: ROAS bands,
fee bands, buyer-profile bands, data-confidence severity. Use full tones for
fills and dots, and the `-ink` variants for text.

### Brand avatars

The brand palette (BARBOURS violet, KOKESHI cyan, ÁPICE amber, LESCENT pink,
RITUÁRIA emerald) is reserved for brand identity marks. It is not used for chart
series or status.

## 3. Typography

**Family:** DM Sans (`next/font/google`, self-hosted at build, `display: swap`,
`--font-sans`), falling back to the system stack. Measured: the Google build of
DM Sans has **no `tnum`** ("1111111" 52px vs "8888888" 102px at 24px), so
**tables** use Inter (`--font-num`), which has real tabular figures and keeps R$
columns aligned.

| Role | Size / weight | Use |
|---|---|---|
| label | 12px / 600, uppercase, tracked 0.04em | KPI labels, table column heads, nav group labels, status badges |
| data | 13px / 400–600 | Dense table cells, nav items |
| body | 14px / 400 | Prose, notes, panel subtitles |
| title | 14px / 600 | Panel titles |
| headline | 20px / 700 | Page title (`<h2>`; Gerencial keeps its `<h1>`) |
| kpi | 24px / 600, −0.015em | KPI card value |
| kpi-hero | 28px / 600 | `KpiTile destaque` only |

**Floor: 12px.** The benchmark uses 10–11px labels everywhere. The Torre does
not copy that: the 12px floor was a deliberate UX-TORRE-1 accessibility
decision, and density comes from spacing, not from smaller type.

**Uppercase labels** belong to data infrastructure: KPI labels, column heads,
nav group labels and badges. Panel titles are mixed-case title weight.

**Tabular numerals** are on for every table and every KPI value
(`tabular-nums`, or the global `table, .tabular` rule).

## 4. Elevation and glass (UX-VIDRO-1)

Three layers, defined once in `app/globals.css` (block "UX-VIDRO-1"):

1. **Background** (`.tc-fundo`, on the app shell root, and `.tc-tema-claro`):
   the canvas plus three radial halos (`--tc-brilho-1..3`), fixed to the
   viewport. Lavender in light, deep violet in dark.
2. **Glass cards**: every `.rounded-xl.border.bg-surface` (Panel, StatCard,
   KpiTile, the Gerencial cards) becomes `rgb(--tc-vidro / .74)` (`.62` in
   dark) with an 18px backdrop blur, a 16px radius, a 1px inner highlight and
   a soft violet drop. Only a NEUTRAL border becomes the glass border
   (`--tc-vidro-borda`); KPI identity and status borders stay. Floating menus
   and dialogs stay almost opaque (`surface / .96`) because they are read over
   content. Without `backdrop-filter` support the card falls back to opaque.
3. **Frame**: `.tc-shell-fundo` gives the navy shell a top-to-bottom step and a
   violet halo at the brand corner; `.tc-marca` is the brand mark, the lighthouse tower of `app/icon.png` (`MarcaTorre`), with the violet glow;
   `.tc-nav-ativo` is the active nav pill (gradient + glow, white ink), and the
   3px left bar stays.

Sticky bars (`PageBar`, the PageHeader filter bar) use `.tc-barra-vidro`, a thin
glass that lets the halo through. Page titles get the violet-to-magenta
gradient through `.tc-titulo-pagina h2` (solid fallback and `forced-colors`
fallback included). Segmented controls are pills (`rounded-full`).

Shadow appears on hover of an interactive card (`.card-hover`: violet glow on a
black base, never the ink colour) and on floating layers. The rules live
outside `@layer` on purpose: they must beat the utilities the components
already declare, without rewriting fifty files.

## 5. Components

The primitives live in `apps/web/src/components/ui/`, plus `layout/` and
`shell/`. A primitive exists only when it has two or more consumers.

| Primitive | File | Consumers |
|---|---|---|
| App shell (navy sidebar, mobile topbar, drawer) | `shell/*` | every route |
| Page header (icon, title, subtitle, meta chips, sticky filter bar) | `layout/PageHeader.tsx`, `gerencial/GerencialHeader.tsx` | 10 routes + Gerencial |
| Filter toolbar | `layout/GlobalFilterControls.tsx` | Gerencial, Canais, Financeiro |
| Brand selector / period selector, `menu` variant | `BrandFilter.tsx`, `DateRangeFilter.tsx` + `ui/Popover.tsx` | toolbar (menu); other routes (faixa) |
| Tab skeleton (icon + title, freshness, sticky filter bar that shrinks on scroll, main strip, attention, panels) | `layout/Aba.tsx` | new routes; the rest migrate in F2/F3 |
| Freshness ("Atualizado HH:MM") | `ui/SeloAtualizado.tsx` (replaces `ui/Freshness.tsx` tab by tab) | via `Aba` |
| Sortable column header | `ui/SortHeader.tsx` | sortable tables |
| Freshness + period chip (legacy) | `ui/Freshness.tsx` | Gerencial, Canais, Financeiro |
| KPI card | `ui/KpiTile.tsx`, `ui/StatCard.tsx`, `gerencial/KpiBand.tsx` | Expedição, Canais, Financeiro, Gerencial |
| Panel (title, subtitle, actions, footer, icon) | `ui/Panel.tsx` | Expedição, Canais, Financeiro, Gerencial |
| Segmented / tabs | `ui/Segmented.tsx` | theme, Expedição, Canais detail tabs |
| Status badge | `ui/Chip.tsx` | Expedição, Canais, Financeiro |
| Data-quality note | `ui/Note.tsx` | all three + Expedição |
| Caveat tip (ⓘ) | `ui/InfoDica.tsx` | every route |
| Table shell (scroll hint) | `TableScrollHint.tsx` | all wide tables |
| Empty / loading / error / unavailable | `ui/StateBlock.tsx` | Canais, Financeiro, Expedição (TikTok) |
| Expedição channel header + photo/freshness chips | `expedicao/CabecalhoExpedicao.tsx` | Expedição queue (Shopee/ML), Expedição TikTok |
| Single data-quality bar | `expedicao/BarraDeQualidade.tsx` | Expedição queue, Expedição TikTok |
| KPI strip, section title, detail invitation | `expedicao/SecoesExpedicao.tsx` | Expedição queue, Expedição TikTok |

### Expedição — one product, two depths (EXPEDICAO-UX-UNIFICADA-1)

- One channel selector (`Shopee | Mercado Livre | TikTok Shop`, identity
  dots) owned by `ExpedicaoShell`. `?channel=` keeps its old values.
- Depth is a segmented control, in the URL (`?visao=detalhe`): **Visão do
  gestor** (default) and **Detalhe operacional** (queue, most critical,
  source by brand; or cohorts and the payment-date flow).
- Bodies stay separate: the queue and the TikTok cohort never share a
  component with channel `if`s. Shared pieces receive view models built by
  each channel's contract.
- States are distinct: loading, error (with retry), absent (`—`, never
  zero), empty (zero measured), partial (named), stale (written
  "Desatualizada", not only amber).
- The sticky band carries identity and freshness only; depth and filters
  scroll with the page, so the band stays short on a 390px screen.

### Expedição — the Gerencial skeleton (IDENTIDADE-GERENCIAL, 08/11/2026)

The manager view follows the Gerencial: one question per fold, numbers
first, depth in "Mais detalhes". Same order on the three channels; each shows
only what its source sustains (`CorpoGestor` owns the order).

0. **Header** — `CabecalhoExpedicao` (channel in the title, "Última
   atualização" chip, "Desatualizada" chip written, once) + `BarraDeQualidade`.
   The bar never repeats what the top already says: photo/series age and
   brands with the source on alert stay only in its "Ver N limitações" list.
1. **Herói** (`ui/Heroi`) — Shopee/ML with a published deadline: "Vencidos"
   as **% of the queue**, context "N pedidos de M em fila", the queue split by
   deadline status (Vencidos / Perto de vencer / No prazo / Sem prazo
   publicado, each with number and ⓘ) in the middle, seal "Com atraso" /
   "Em dia", chips "inclui FBS" (with ⓘ) and "N marcas em alerta" next to the
   number, "Ver pedidos →" always visible. ML without deadline: "Acima de
   48 h" (internal threshold, said in the ⓘ), seal "Acima do limiar" /
   "Dentro do limiar", backlog bar with +48 h and travados overlaid. TikTok:
   "Vencidos" as % of the open orders, split "aguardando coleta · aguardando
   envio". A brand with several accounts shows "—" with the reason (never 0).
2. **Faixa** — `KpiTile variante="gerencial"`, % of the queue as value and
   the count below, each card opens the order list. Shopee: Perto de vencer ·
   Acima de 48 h · Travados. ML without deadline: Travados · Pedido mais
   antigo em fila. TikTok: Vence hoje · Vence dd/mm · Acima de 48 h · LDR da
   janela. Never repeats the hero. Each card has its identity colour
   (CARDS-KPIBAND: Perto de vencer / Vence hoje / Vence dd/mm `kpi-prazo`,
   Acima de 48 h and Pedido mais antigo `kpi-pedidos`, Travados `kpi-ads`,
   LDR da janela `kpi-ticket`). Delta in p.p. + "antes" + sparkline only
   from real data: queue cards from the hourly series (hours where every
   account has a point; first and last hour complete for the delta), the
   TikTok LDR from closed due days and `ldr.previous`. Shopee with the
   seller × FBS split has no delta: the card is the seller queue and the
   series is the published one.
3. **O que exige atenção agora** (`ui/FilaAtencao`, up to 6 on the queue) —
   accounts with vencidos by concentration ("{Marca}: X dos Y vencidos", the
   old "Onde agir"), official Performance metrics outside the limit, then
   accounts with perto de vencer or travados. TikTok: the API alerts. A brand
   without an account is an info item ("não é backlog zero").
4. **Backlog por marca** — Agora | Últimos 7 dias. One number per cell; the
   "% da fila" goes to `title` + `sr-only`; "conta i de n · atualizada hh:mm"
   is a second line only when the brand has more than one account. "Inclui
   FBS" is `title` + `sr-only` of the title (the visible chip is the hero's).
5. **TikTok only**: Evolução por dia de vencimento (7/12) | Concentração por
   marca (5/12).
6. **LDR · últimos 7 dias** (`LdrTopo`) — the only 7-day LDR in this view.
7. **Mais detalhes** (`ui/MaisDetalhes`, closed): Prazo (Shopee LDR panel
   with its flag; TikTok window KPIs, "Vencem hoje ou amanhã (janela da
   LDR)"), Jornada (its own staleness goes to the ⓘ), Pedidos FBS with the
   reconciliation line, Performance oficial.
8. Invitation to the operational detail.

Detalhe operacional: KPI cards in the `gerencial` variant; secondary
indicators inside `MaisDetalhes`. The rest is unchanged.

### Sidebar

- 240px expanded, 64px icon rail.
- **Auto mode** shows the rail below 1280px and the expanded bar above. Only a
  choice made on a wide screen persists (`localStorage: torre-sidebar`).
- The theme selector lives in the sidebar footer: segmented when expanded, one
  cycling button in the rail.
- Mobile uses a navy topbar with a hamburger that opens a navy drawer with
  44px targets.

### Filter toolbar

- One row on desktop, sticky.
- Channel is a segmented control with identity dots.
- Brand and period are popover triggers showing the current value ("Marca:
  Todas", "Período: Mês anterior").
- Every target is 44px; that contract is V3 and is not traded for density.
- Below `sm` the bar collapses behind a "Filtros" button that shows the scope
  summary.

### KPI card

- Uppercase label at the top left and a 28px icon tile at the top right (series
  tint, not status).
- 24px value, then a delta pill (`ok-soft` / `crit-soft` with an arrow), then
  the reference.
- No note under the number. A caveat that changes the reading goes into an
  `InfoDica` (ⓘ) next to the label or a short chip.

### Grade única das abas (ALVO-GRADE, approved 12/11/2026)

The owner approved one composition for **every** tab (artifact "Torre em grade
única"). Build tabs from these pieces; do not restyle them per tab.

| Piece | File | Use |
|---|---|---|
| Frame | `shell/AppShell.tsx`, `shell/Sidebar.tsx`, `.tc-moldura*` | Two rounded panels with air around: navy menu + glass content. Nothing to do per tab. |
| `Aba` | `layout/Aba.tsx` | Skeleton, in this order: big title + `selo`; `visoes` (tabs under the title, with `ponto` when the tab is a channel); `filtros` + `direita` on one row; `faixa` (the 4 cards); `atencao`; `children` (panels and tables). |
| `CartaoIndicador` | `ui/CartaoIndicador.tsx` | The only KPI card: `rotulo`, `icone`, `cor` (identity), `valor`, `pilula {texto, tom}`, optional `progresso` (0..1), `legenda`, `serie` (trend line, 4+ real points), `ajuda`, `onAbrir`. |
| `Panel` | `ui/Panel.tsx` | Panel with `titulo`, one `ajuda` (ⓘ) and `acao` in the corner: the panel's own `Segmented` or a "Ver todos →" link. No loose controls. |
| `CelulaBarra` | `ui/CelulaBarra.tsx` | Numeric table cell with weight: value + thin bar in the identity colour. Replaces heat maps (rejected). |
| Motion | `globals.css` (`--mov-*`, `.tc-barra`, `.tc-barra-dir`, `.tc-cartao-linha`, `.tc-entrada`) | Blocks enter in sequence, bars grow, the card lifts on hover, the trend line draws once. All off under reduced motion. |

```tsx
<Aba
  titulo="Expedição"
  selo={<SeloAtualizado em={geradoEm} />}
  visoes={[{ id: "shopee", rotulo: "Shopee", ponto: "bg-canal-shopee" }, { id: "ml", rotulo: "Mercado Livre", ponto: "bg-canal-ml" }]}
  visao={canal}
  onVisao={setCanal}
  filtros={<GlobalFilterControls … />}
  direita={<Segmented rotulo="Visão" … />}
  faixa={
    <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
      <CartaoIndicador rotulo="Vencidos" icone={TriangleAlert} cor="#ef4444" valor="8,6%"
        pilula={{ texto: "Com atraso", tom: "crit" }} legenda="100 de 1.162 na fila" serie={serie} onAbrir={abrir} />
      {/* …mais três, sempre quatro */}
    </div>
  }
>
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
    <Panel titulo="Fila por situação de prazo" acao={<Segmented … />}>…</Panel>
    <Panel titulo="O que exige atenção" acao={<a href="…">Ver todos →</a>}>…</Panel>
  </div>
  <Panel titulo="Vencidos por marca" semPadding>{/* tabela em largura total; <td><CelulaBarra … /></td> */}</Panel>
</Aba>
```

Rules: always **four** cards in the strip, same anatomy; identity colours are
`#8b5cf6` violet, `#f59e0b` amber, `#3b82f6` blue, `#ec4899` pink, `#10b981`
green, `#ef4444` red (state lives in the pill, never in the card colour); no
trend line without a real series; absence is "—" or "N/D", never zero; cleaning
means less **text**, never less visual richness.

### Tab skeleton (UI-FUNDACAO F1, 12/11/2026)

Every tab is built from the same parts, in the same order (`layout/Aba.tsx`):

1. Header: 32px icon tile + title on the left; `SeloAtualizado` on the right.
2. Filter bar: sticky; it shrinks (less padding, a soft shadow) once the page
   scrolls. Canal · Marca · Período, then the tab's own controls on the right.
3. Main strip: the hero and the indicator cards.
4. "O que exige atenção".
5. Panels and tables.

- Freshness reads "Atualizado HH:MM" (another day: "dd/mm HH:MM"). The live
  dot is green; demo mode stays written out; no time means "—". Past the
  source's SLA (each tab decides) it reads "Desatualizado · HH:MM" in warning
  tone — written, never colour only.
- A route outside the skeleton fails `tests/ui-fundacao.test.ts` unless it is
  on the exception list there. The list only shrinks.

### Motion (UI-FUNDACAO F1)

- One curve (`--mov-ease`) and three durations: 120ms responds (hover, colour),
  180ms opens and closes (popover, segmented), 240ms enters (panels, bars).
- Utilities: `tc-painel-entra` (panel entrance), `tc-troca` + `aria-busy`
  (filtering keeps the old content dimmed instead of blanking it), popover
  scale + fade on the tokens.
- Only `transform` and `opacity` animate. Everything stops under
  `prefers-reduced-motion`.

### Panel

- 12px radius, 1px border.
- Header: optional 16px icon, title (14/600), one-line subtitle, actions on the
  right.
- Methodology goes in ONE ⓘ next to the title (`ajuda`), never in a caption.
- No methodology on screen (ABAS-OBJETIVAS, 29/10/2026): no "Como ler",
  no explanatory subtitle or footer. A caveat that changes how a number is
  read becomes a chip of up to ~8 words or an `InfoDica`; the rest is cut.
  Every tab follows the Gerencial: title, chips, numbers.

### Tables

- Head on `raised`, using the label style.
- Rows are 13–14px with no zebra striping and a hover tint.
- Numbers are right-aligned and tabular.
- Sorting: ▲/▼ in accent only on the active column; the others keep a faded ↕
  (40%) that turns full on hover or focus, so touch users still see it sorts.
- The total row sits on `raised` with a 2px top border.
- Wide tables scroll inside the panel, with a visible hint.

### Charts

- Recharts.
- Grid from `--tc-chart-grid`, 12px axis ticks, no axis lines.
- Series colour comes from position or channel identity, never status.
- Every chart has a title and the period in its header.

### Identidade Gerencial nas abas principais (IDENTIDADE-GERENCIAL)

CX, Expedição e Full seguem o esqueleto da Gerencial (`app/page.tsx`), sem que a Gerencial mude:

0. **Cabeçalho**: `PageHeader` (ícone da rota, título; frescor/período como chips em `meta`).
1. **Herói** (`ui/Heroi`): UM número dominante (`text-3xl` bold, tabular), rótulo uppercase em cima, 1 linha de contexto, aviso de dado colado no número, `meio` para barra ou quebra por canal, selo de status à direita **só com regra de negócio**. Tom só na tinta do número, nunca no fundo.
2. **Faixa de KPIs**: 3–5 `KpiTile variante="gerencial"` (vidro neutro, ladrilho de ícone, valor `text-2xl`; com `onAbrir` vira botão que abre o `KpiDrilldownDialog` único da página). Não repete o herói. 2 colunas no mobile.
3. **"O que exige atenção agora"**: `ui/FilaAtencao` (selo Crítico/Atenção/Informativo) ou tabela curta quando cada linha tem valor.
4. **Evolução | Onde** (7/12 | 5/12 a partir de `lg`). Sem série de verdade, o bloco de evolução não existe.
5. **Detalhe**: a tabela principal da aba.
6. **Mais detalhes** (`ui/MaisDetalhes`, fechado): indicadores secundários, qualidade do dado, frescor por fonte.

Regras: cartão = rótulo · valor · no máximo 1 linha; ressalva no ⓘ; "x de y" fora da vista (`title` + `sr-only`); ausência é "—" com motivo; "Desatualizada" escrito e visível sem hover. `KpiTile` sem `variante` continua idêntico (faixa padrão).

#### Card de valor com comparação = card da faixa da Gerencial

Todo card de valor com comparação nas abas principais usa o mesmo card da `KpiBand`: `KpiTile variante="gerencial" identidade="…"`. A cor de **identidade** (`kpi-*`) pinta a borda, o brilho em degradê no canto (do `globals.css`), o ladrilho do ícone (`h-8`) e o mini gráfico. **Ela não diz bom ou ruim:** isso fica no `ui/DeltaBadge` (↗/↘ verde ou vermelho conforme o tom; `neutral` sem juízo; `unidade="pp"` para taxa) e na tinta do valor. O rodapé traz o delta e o "antes X" à esquerda e o `ui/Sparkline` à direita. Sem período anterior real não há delta nem "antes"; sem série real (≥ 4 pontos), não há gráfico. Nada é inventado.

O mesmo KPI tem a mesma cor em toda aba:

| Token | Cor | KPIs |
|---|---|---|
| `kpi-gmv` | violeta | GMV · Impacto potencial ML/Shopee (Full) · Reembolso (CX) · Taxa de reembolso (site) |
| `kpi-pedidos` | âmbar | Pedidos · Param a venda (Full) · Acima de 48 h · Pedido mais antigo · Reviews 1–3 ★ |
| `kpi-ticket` | índigo | Ticket médio · LDR da janela |
| `kpi-ads` | fúcsia | Investimento em Ads · Travados · Cancelamento · Taxa de reenvio (site) |
| `kpi-roas` | verde | ACOS/ROAS |
| `kpi-prazo` | azul (novo) | Perto de vencer · Vence hoje · Vence dd/mm |
| `kpi-atendimento` | verde-azulado (novo) | Contact rate · NPS do site |

Contraste medido (WCAG) do ícone e do gráfico. "Vidro" é a superfície com o brilho no máximo (16 % no claro, 22 % no escuro), onde fica o mini gráfico; "ladrilho" é a cor a 10 % sobre a superfície. Meta: ≥ 3:1.

| Token | Claro: superfície · ladrilho · vidro | Escuro: superfície · ladrilho · vidro |
|---|---|---|
| `kpi-gmv` | 7,1 · 6,0 · 5,5 | 6,2 · 5,3 · 4,3 |
| `kpi-pedidos` | 3,9 · 3,5 · 3,2 | 10,2 · 8,4 · 6,3 |
| `kpi-ticket` | 6,3 · 5,4 · 4,9 | 5,7 · 4,9 · 4,0 |
| `kpi-ads` | 4,7 · 4,1 · 3,7 | 6,9 · 5,9 · 4,6 |
| `kpi-roas` | 3,8 · 3,3 · 3,1 | 8,8 · 7,5 · 5,7 |
| `kpi-prazo` | 5,2 · 4,5 · 4,1 | 6,7 · 5,7 · 4,5 |
| `kpi-atendimento` | 5,5 · 4,8 · 4,4 | 9,1 · 7,7 · 5,8 |

No tema claro, o âmbar (`kpi-pedidos` e `warn`) é 194 106 5 (#c26a05) desde 09/11. O tom anterior, 217 119 6, dava 2,77:1 no canvas, 2,86 no ladrilho e 2,87 no raised (ponto ou barra warn); o novo dá 3,41, 3,48 e 3,54, e 3,92 na superfície. O tema escuro não mudou.

## 6. Do's and Don'ts

**Do**

- Put a number in the first viewport of every route, above any prose.
- Turn metadata sentences into chips: period, freshness, coverage.
- Keep a quality warning only when it changes the reading of a number: a
  short chip, with the full text in an `InfoDica`.
- Repeat the route icon in the page header.
- Keep the 44px target on every filter control and the 12px type floor.

**Don't**

- Use a charcoal/grey sidebar with an electric-blue accent (the Metabase
  default). The shell is navy-violet.
- Fill filter options with solid violet.
- Use status colours without a business rule, or channel colours for anything
  except identity.
- Put a shadow on static panels, use a coloured side stripe on cards or alerts,
  or use gradient text.
- Call any cost view "margem real". Known costs are labelled as known costs,
  and missing components are named as missing.

---

## 7. Semantic tokens and the two themes (UX-TORRE-1, extended)

No screen writes a hex or a palette literal. Each colour is a **role**, and the
role's value is defined once per theme in `apps/web/app/globals.css`.

### The token layer

| Role | Token | Light | Dark |
|---|---|---|---|
| Page field | `--tc-canvas` | `#f1edfc` | `#0d0822` |
| Card | `--tc-surface` | `#ffffff` | `#1e1540` |
| Elevated / inset | `--tc-raised` | `#f4f2fb` | `#291e52` |
| Border | `--tc-line` / `--tc-line-strong` | `#e7e3f5` / `#d6d0ec` | `#382c62` / `#4c3e80` |
| Text | `--tc-ink` / `--tc-muted` / `--tc-faint` | `#171226` / `#524c67` / `#6c6582` | `#f2effa` / `#b8b0d0` / `#968db2` |
| Accent | `--tc-accent` (+ `-soft`, `-ink`, `-on`) | `#6d28d9` | `#a78bfa` |
| Success / Warn / Critical | `--tc-ok` / `--tc-warn` / `--tc-crit` (+ `-soft`, `-ink`) | `#059669` / `#d97706` / `#e11d48` | `#34d399` / `#fbbf24` / `#fb7185` |
| Series 1–6 | `--tc-chart-1…6` | violet, sky, slate, purple, cyan, slate-dark | the lighter counterpart of each |
| Channel identity (UX-TORRE-2) | `--tc-canal-tiktok` / `-ml` / `-shopee` | `#8b5cf6` / `#06b6d4` / `#f97316` | `#a78bfa` / `#22d3ee` / `#fb923c` |
| Shell (UX-TORRE-B2B-1) | `--tc-shell` (+ `-raised`, `-line`, `-ink`, `-muted`, `-faint`, `-accent`, `-active`) | `#12112b` | `#0a0914` |

Tokens are stored as **RGB channels** (`23 18 38`), never `#rrggbb`. Tailwind
injects the alpha inside `rgb(var(--tc-ink) / <alpha-value>)`, which is why
`text-ink/70` works.

The tokens enforce three rules:

1. **Dark is not an inversion.** Each role has its own value per theme,
   checked for ≥4.5:1 body text and ≥3:1 large text and UI.
2. **Full `ok`/`warn`/`crit` are fills.** Text uses the `-ink` variant.
3. **`-on` is the ink that sits on the full accent.** It flips in dark.

### Theme switching

- `darkMode: "class"`.
- Three states (`light`, `dark`, `system`), persisted under `torre-tema`.
- A synchronous `<head>` script applies the theme before first paint.

### Migration barrier

Routes in `ROTAS_TEMATIZADAS` (`src/lib/theme.ts`) are on tokens. Every other
route renders under `.tc-tema-claro`. The shell is themed on every route; a
route's content joins the dark theme only when its PR adds it to the list.
