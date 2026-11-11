interface Tab<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (value: T) => void;
}

/** Navegacao por marketplace compartilhada entre as abas de Produtos. */
export default function ProductMarketplaceTabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
    <div role="tablist" aria-label="Marketplace" className="flex items-center gap-1 bg-surface border border-line rounded-xl p-1 w-fit shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={active === t.value}
          onClick={() => onChange(t.value)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            active === t.value
              ? "bg-accent text-accent-on shadow-sm"
              : "text-ink-muted hover:text-ink hover:bg-raised"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
