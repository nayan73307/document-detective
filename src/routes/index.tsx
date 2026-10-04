import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meridian Investigator — Ask your documents" },
      {
        name: "description",
        content: "Upload PDFs, images and text files, then ask questions and get cited answers.",
      },
      { property: "og:title", content: "Meridian Investigator — Ask your documents" },
      {
        property: "og:description",
        content: "Find scattered facts across many files without reading every page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Kind = "pdf" | "image" | "text";
type Doc = { id: string; name: string; kind: Kind; mime: string; size: number; data: string };
type Source = { n: number; file: string; location?: string; quote?: string };
type Turn = { q: string; a?: string; sources?: Source[]; error?: string };

const MAX_TOTAL = 18 * 1024 * 1024;

const kindStyle: Record<Kind, { label: string; badge: string; bar: string; dot: string; text: string }> = {
  pdf: { label: "PDF", badge: "bg-sky/15 text-sky ring-sky/30", bar: "bg-sky/70", dot: "bg-sky", text: "text-sky" },
  image: { label: "IMG", badge: "bg-accent/15 text-accent ring-accent/30", bar: "bg-accent/70", dot: "bg-accent", text: "text-accent" },
  text: { label: "TXT", badge: "bg-foreground/10 text-foreground ring-border", bar: "bg-primary/70", dot: "bg-primary", text: "text-primary" },
};

function detectKind(f: File): Kind | null {
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("text/") || /\.(txt|md|csv|json|log|xml|html?)$/i.test(f.name)) return "text";
  return null;
}

function readFile(f: File, kind: Kind): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const res = String(r.result);
      resolve(kind === "pdf" ? res.split(",")[1] ?? "" : res);
    };
    if (kind === "text") r.readAsText(f);
    else r.readAsDataURL(f);
  });
}

function fmtSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

const SUGGESTIONS = ["Summarize the key facts", "List every date and deadline", "Who are the people involved?"];

function Index() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setNotice(null);
    let total = docs.reduce((s, d) => s + d.size, 0);
    const added: Doc[] = [];
    for (const f of Array.from(list)) {
      const kind = detectKind(f);
      if (!kind) {
        setNotice(`"${f.name}" isn't supported. Use PDFs, images or text files.`);
        continue;
      }
      if (total + f.size > MAX_TOTAL) {
        setNotice("That's over the 18MB limit for one investigation.");
        break;
      }
      total += f.size;
      const data = await readFile(f, kind);
      added.push({ id: crypto.randomUUID(), name: f.name, kind, mime: f.type, size: f.size, data });
    }
    setDocs((d) => [...d, ...added]);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    if (!docs.length) {
      setNotice("Add at least one file first.");
      return;
    }
    setInput("");
    setNotice(null);
    setBusy(true);
    const history = turns.filter((t) => t.a).map((t) => ({ q: t.q, a: t.a! }));
    setTurns((t) => [...t, { q }]);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history,
          docs: docs.map(({ name, kind, mime, data }) => ({ name, kind, mime, data })),
        }),
      });
      const json = await res.json().catch(() => ({ error: "Unexpected response." }));
      setTurns((t) =>
        t.map((x, i) =>
          i === t.length - 1
            ? res.ok
              ? { ...x, a: json.answer, sources: json.sources ?? [] }
              : { ...x, error: json.error ?? "Something went wrong." }
            : x,
        ),
      );
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: "Network error. Try again." } : x)));
    } finally {
      setBusy(false);
    }
  }

  const kindOf = (file: string) => docs.find((d) => d.name === file)?.kind ?? "text";

  return (
    <div
      className="min-h-screen w-full bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,image/*,.txt,.md,.csv,.json,.log,.xml,.html"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <header className="sticky top-0 z-20 bg-background/85 ring-1 ring-border/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <div className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-primary/15 ring-1 ring-primary/40">
            <span className="size-2.5 rounded-full bg-primary" />
          </div>
          <div className="leading-none">
            <h1 className="font-display text-[13px] font-semibold tracking-tight">Meridian Investigator</h1>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {docs.length} files · {turns.length} questions · {docs.length ? "ready" : "awaiting evidence"}
            </p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium text-primary">
            <span className={`size-1.5 rounded-full bg-primary ${busy ? "animate-pulse" : ""}`} />
            {busy ? "Reading" : "Live"}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 pb-28 pt-3">
        <section
          className={`rounded-[14px] bg-card p-3 ring-1 transition ${drag ? "ring-primary" : "ring-border/50"}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Evidence board
            </h2>
            <button onClick={() => fileRef.current?.click()} className="text-[11px] font-medium text-primary">
              + Add files
            </button>
          </div>
          {docs.length === 0 ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-[10px] border border-dashed border-border bg-glass/50 px-4 py-8 text-center"
            >
              <p className="font-display text-sm font-medium">Drop PDFs, images or text files</p>
              <p className="mt-1 text-[11px] text-muted-foreground">or tap to browse · up to 18MB total</p>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {docs.map((d) => {
                const k = kindStyle[d.kind];
                return (
                  <div key={d.id} className="group relative rounded-[10px] bg-glass p-2.5 ring-1 ring-border/50">
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={`rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${k.badge}`}
                      >
                        {k.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {d.kind === "image" ? "OCR" : fmtSize(d.size)}
                      </span>
                    </div>
                    <p className="break-words text-[11px] font-medium leading-tight">{d.name}</p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                      <div className={`h-full w-full ${k.bar}`} />
                    </div>
                    <button
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setDocs((x) => x.filter((y) => y.id !== d.id))}
                      className="absolute right-1 top-7 text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {notice && <p className="mt-2 text-[11px] text-accent">{notice}</p>}
        </section>

        <section className="rounded-[14px] bg-card p-3 ring-1 ring-border/50">
          <h2 className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Investigation thread
          </h2>
          {turns.length === 0 && (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground">
                Ask anything in plain language. Answers point to the exact file and passage.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full bg-secondary px-2.5 py-1 text-[11px] ring-1 ring-border/60 hover:ring-primary/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-3">
            {turns.map((t, i) => (
              <div key={i}>
                <div className="rounded-[10px] bg-secondary px-3 py-2 ring-1 ring-border/50">
                  <p className="mb-1 text-[11px] text-muted-foreground">You asked</p>
                  <p className="text-balance text-[13px] font-medium leading-snug">{t.q}</p>
                </div>
                <div className="mt-2 rounded-[10px] bg-glass px-3 py-3 ring-1 ring-border/50">
                  {!t.a && !t.error && (
                    <p className="animate-pulse text-[12px] text-muted-foreground">
                      Reading {docs.length} files and cross-checking…
                    </p>
                  )}
                  {t.error && <p className="text-[12px] text-destructive">{t.error}</p>}
                  {t.a && (
                    <>
                      <p className="whitespace-pre-wrap text-pretty text-[13px] leading-relaxed">
                        {t.a.split(/(\[\d+\])/g).map((part, j) =>
                          /^\[\d+\]$/.test(part) ? (
                            <span
                              key={j}
                              className="mx-0.5 inline-grid size-[15px] place-items-center rounded-full bg-primary/15 align-baseline text-[9px] font-semibold text-primary ring-1 ring-primary/40"
                            >
                              {part.slice(1, -1)}
                            </span>
                          ) : (
                            part
                          ),
                        )}
                      </p>
                      {t.sources?.map((s) => {
                        const k = kindStyle[kindOf(s.file)];
                        return (
                          <div key={s.n} className="mt-2 rounded-[8px] bg-background px-2.5 py-2 ring-1 ring-border/50">
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className={`size-1.5 shrink-0 rounded-full ${k.dot}`} />
                              <span className={`text-[10px] font-medium ${k.text}`}>
                                [{s.n}] {s.file}
                                {s.location ? ` · ${s.location}` : ""}
                              </span>
                            </div>
                            {s.quote && (
                              <p className="text-pretty text-[11px] italic leading-snug text-muted-foreground">
                                "{s.quote}"
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div ref={endRef} />
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 bg-background/90 px-3 py-2.5 ring-1 ring-border/60 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="mx-auto flex max-w-3xl items-center gap-2 rounded-[12px] bg-card px-3 py-2 ring-1 ring-border/60 focus-within:ring-primary/60"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the evidence…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Ask"
            className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-primary text-[15px] font-bold leading-none text-primary-foreground disabled:opacity-40"
          >
            ↑
          </button>
        </form>
      </footer>
    </div>
  );
}
