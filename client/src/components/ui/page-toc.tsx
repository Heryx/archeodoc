import { useEffect, useState } from "react";

type TocEntry = { id: string; title: string };

type PageTocProps = {
  /** Sotto questa soglia il sommario non viene mostrato (pagina corta) */
  minEntries?: number;
};

/**
 * Sommario a chip per pagine lunghe: raccoglie i titoli delle Card (CardTitle) e
 * i nodi con data-toc della pagina, e permette di saltare alla sezione cliccando.
 */
export function PageToc({ minEntries = 5 }: PageTocProps) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [entries, setEntries] = useState<TocEntry[]>([]);

  useEffect(() => {
    if (!anchor) return;
    const root = anchor.parentElement;
    if (!root) return;

    const scan = () => {
      const found: TocEntry[] = [];
      root.querySelectorAll<HTMLElement>('[data-slot="card-title"], [data-toc]').forEach((el, i) => {
        const title = (el.getAttribute("data-toc") || el.textContent || "").trim();
        if (!title) return;
        if (!el.id) el.id = `toc-${i}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
        found.push({ id: el.id, title });
      });
      setEntries((prev) =>
        prev.length === found.length && prev.every((p, i) => p.id === found[i].id && p.title === found[i].title)
          ? prev
          : found,
      );
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [anchor]);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div ref={setAnchor}>
      {entries.length >= minEntries && (
        <nav
          aria-label="Sommario"
          className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-1 py-2 backdrop-blur"
        >
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vai a</span>
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => jump(e.id)}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {e.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
