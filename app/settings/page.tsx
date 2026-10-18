"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Check, ChevronDown, CircleAlert, Cpu, Loader2, Palette, RefreshCw, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { dict, type Lang } from "@/lib/i18n";
import { useDismiss } from "@/lib/hooks";
import type { ModelOption } from "@/lib/provider";

type Provider = "anthropic" | "custom";

interface Settings {
  provider: Provider;
  model: string;
  baseURL: string;
  hasKey: boolean;
  keyHint: string;
  source: "file" | "env" | "none";
  configured: boolean;
  configPath: string;
  defaultModel: string;
}

type SettingsDict = ReturnType<typeof dict>["settings"];

const CARD = "rounded-xl border border-border bg-card shadow-sm";
const LABEL = "text-[13px] font-medium text-foreground";
const HINT = "text-xs leading-relaxed text-subtle";

export default function SettingsPage() {
  // useSearchParams needs a Suspense boundary in the app router
  return (
    <Suspense>
      <SettingsForm />
    </Suspense>
  );
}

function SettingsForm() {
  const router = useRouter();
  const welcome = useSearchParams().get("welcome") === "1";
  const [lang, setLang] = useState<Lang>("en");
  const t = dict(lang).settings;

  const [saved, setSaved] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelsReq = useRef(0);

  useEffect(() => {
    if (navigator.language?.toLowerCase().startsWith("ru")) setLang("ru");
    fetch("/api/settings").then(r => r.json()).then((s: Settings) => {
      setSaved(s);
      setProvider(s.provider);
      setBaseURL(s.baseURL);
      setModel(s.model);
      loadModels(s.provider, "", s.baseURL, s);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the saved key counts only for the provider it was saved for
  const keyUsable = (p: Provider, typed: string, s = saved) =>
    Boolean(typed.trim() || (s?.hasKey && s.provider === p));

  async function loadModels(p = provider, key = apiKey, url = baseURL, s = saved) {
    const req = ++modelsReq.current;
    setModelsError(null);
    if (!keyUsable(p, key, s) || (p === "custom" && !url.trim())) {
      setModels(null);
      return;
    }
    setModelsLoading(true);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p, apiKey: key, baseURL: url }),
      });
      const json = await res.json().catch(() => ({}));
      if (req !== modelsReq.current) return;
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setModels(json.models);
    } catch (err) {
      if (req !== modelsReq.current) return;
      setModels(null);
      setModelsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (req === modelsReq.current) setModelsLoading(false);
    }
  }

  function switchProvider(p: Provider) {
    if (p === provider) return;
    setProvider(p);
    setApiKey("");
    setModel(p === saved?.provider ? saved.model : "");
    const url = p === saved?.provider ? saved.baseURL : "";
    setBaseURL(url);
    setModels(null);
    loadModels(p, "", url);
  }

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, model, baseURL }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSaved(json);
      setApiKey("");
      if (welcome) { router.push("/"); return; }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sameProviderKey = saved?.hasKey && saved.provider === provider;
  const keyNote = sameProviderKey
    ? (saved.source === "env" ? t.keyFromEnv : t.keySaved).replace("{hint}", saved.keyHint)
    : null;
  const effectiveModel = model || (provider === "anthropic" ? saved?.defaultModel ?? "" : "");

  return (
    <main className="mx-auto max-w-xl px-6 pt-10 pb-24">
      <Link href="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-8">
        <ArrowLeft className="size-3.5" />{t.back}
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight mb-6">{t.title}</h1>

      {welcome && saved && !saved.configured && (
        <div className="mb-6 flex gap-3 rounded-xl border border-ring/30 bg-ring/[0.07] px-4 py-3.5">
          <Sparkles className="size-4 shrink-0 mt-0.5 text-ring" />
          <div>
            <div className="text-sm font-medium">{t.welcome}</div>
            <div className={cn(HINT, "mt-0.5")}>{t.welcomeSub}</div>
          </div>
        </div>
      )}

      <form onSubmit={save} className={cn(CARD, "mb-6")}>
        <SectionHead icon={<Cpu className="size-4" />} title={t.model} />

        <div className="space-y-5 px-5 pb-5">
          {/* provider */}
          <div className="space-y-2">
            <div className={LABEL}>{t.provider}</div>
            <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1">
              {(["anthropic", "custom"] as const).map(p => (
                <button key={p} type="button" role="radio" aria-checked={provider === p}
                  onClick={() => switchProvider(p)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    provider === p
                      ? "bg-background text-foreground font-medium shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground",
                  )}>
                  {p === "anthropic" ? t.anthropic : t.custom}
                </button>
              ))}
            </div>
          </div>

          {provider === "custom" && (
            <Field label={t.baseUrl} hint={t.baseUrlHintCustom}>
              <Input value={baseURL} onChange={e => setBaseURL(e.target.value)}
                onBlur={() => loadModels()} placeholder="https://…/v1"
                spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />
            </Field>
          )}

          {/* key */}
          <Field label={provider === "anthropic" ? t.apiKey : t.apiToken} hint={keyNote ?? undefined}>
            <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              onBlur={() => { if (apiKey.trim()) loadModels(); }}
              placeholder={sameProviderKey ? "••••••••" : provider === "anthropic" ? "sk-ant-…" : ""}
              spellCheck={false} autoComplete="off" autoFocus={welcome}
              className="font-mono text-[13px]" />
          </Field>

          {/* model */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL}>{t.modelLabel}</span>
              <button type="button" onClick={() => loadModels()}
                disabled={modelsLoading || !keyUsable(provider, apiKey)}
                className="inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors">
                <RefreshCw className={cn("size-3", modelsLoading && "animate-spin")} />{t.refreshModels}
              </button>
            </div>
            <ModelSelect
              t={t}
              value={effectiveModel}
              models={models}
              loading={modelsLoading}
              defaultModel={provider === "anthropic" ? saved?.defaultModel : undefined}
              onChange={setModel}
            />
            {modelsError ? (
              <div className="flex items-start gap-1.5 text-xs leading-relaxed text-destructive">
                <CircleAlert className="size-3.5 shrink-0 mt-px" />
                <span className="break-words min-w-0">{modelsError}</span>
              </div>
            ) : (
              <div className={HINT}>
                {!keyUsable(provider, apiKey) ? t.modelsNeedKey
                  : provider === "anthropic" ? t.modelHintAnthropic : t.modelHintCustom}
              </div>
            )}
          </div>

          {provider === "anthropic" && (
            <Field label={t.baseUrl} optional={t.optional} hint={t.baseUrlHintAnthropic}>
              <Input value={baseURL} onChange={e => setBaseURL(e.target.value)}
                onBlur={() => { if (baseURL.trim() !== (saved?.baseURL ?? "")) loadModels(); }}
                placeholder="https://api.anthropic.com"
                spellCheck={false} autoComplete="off" className="font-mono text-[13px]" />
            </Field>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-xs leading-relaxed text-destructive">
              <CircleAlert className="size-3.5 shrink-0 mt-px" />
              <span className="break-words min-w-0">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border bg-surface px-5 py-3 rounded-b-xl">
          <span className="mr-auto min-w-0 truncate text-[11px] font-mono text-faint">
            {saved && t.storedIn.replace("{path}", saved.configPath.replace(/^\/(Users|home)\/[^/]+/, "~"))}
          </span>
          {justSaved && (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" />{t.saved}
            </span>
          )}
          <Button type="submit" disabled={busy || !saved} className="gap-1.5 px-4">
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? t.saving : t.save}
          </Button>
        </div>
      </form>

      <section className={CARD}>
        <SectionHead icon={<Palette className="size-4" />} title={t.appearance} />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5">
          <span className={LABEL}>{t.theme}</span>
          <ThemeToggle labels={t} withLabels />
        </div>
      </section>
    </main>
  );
}

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pt-4 pb-4 text-sm font-semibold">
      <span className="text-subtle">{icon}</span>{title}
    </div>
  );
}

function Field({ label, hint, optional, children }: {
  label: string;
  hint?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-2">
        <span className={LABEL}>{label}</span>
        {optional && <span className="text-[11px] text-faint">{optional}</span>}
      </span>
      {children}
      {hint && <span className={cn(HINT, "block")}>{hint}</span>}
    </label>
  );
}

/**
 * Model picker over the live list from the provider, with a filter. Typing
 * an id that isn't listed offers to use it as-is — for gateways that hide
 * models from /models, or a model released after the list was loaded.
 */
function ModelSelect({ t, value, models, loading, defaultModel, onChange }: {
  t: SettingsDict;
  value: string;
  models: ModelOption[] | null;
  loading: boolean;
  defaultModel?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));

  useEffect(() => { if (open) setQuery(""); }, [open]);

  const current = models?.find(m => m.id === value);
  const q = query.trim().toLowerCase();
  const shown = (models ?? []).filter(m =>
    !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  const typed = query.trim();
  const offerTyped = typed && !(models ?? []).some(m => m.id === typed);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border border-input bg-transparent px-3 py-2 text-left transition-colors",
          "hover:border-border-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
          open && "border-border-strong",
        )}>
        <span className="min-w-0 flex-1">
          {value ? (
            <>
              <span className="block truncate text-sm text-foreground">{current?.name ?? value}</span>
              {current && current.name !== current.id && (
                <span className="block truncate font-mono text-[11px] text-subtle">{current.id}</span>
              )}
            </>
          ) : (
            <span className="text-sm text-subtle">{t.chooseModel}</span>
          )}
        </span>
        {loading
          ? <Loader2 className="size-4 shrink-0 animate-spin text-subtle" />
          : <ChevronDown className="size-4 shrink-0 text-subtle" />}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          <div className="border-b border-border p-2">
            <Input value={query} onChange={e => setQuery(e.target.value)} autoFocus
              placeholder={t.modelSearch} spellCheck={false}
              onKeyDown={e => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (shown.length === 1 || (shown[0] && !offerTyped)) pick(shown[0].id);
                else if (offerTyped) pick(typed);
              }}
              className="h-8 font-mono text-[12.5px]" />
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {loading && !models && (
              <li className="flex items-center gap-2 px-3 py-2.5 text-xs text-subtle">
                <Loader2 className="size-3.5 animate-spin" />{t.modelsLoading}
              </li>
            )}
            {shown.map(m => (
              <li key={m.id}>
                <button type="button" onClick={() => pick(m.id)}
                  className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-surface-hover transition-colors">
                  <Check className={cn("size-3.5 shrink-0 mt-0.5", m.id === value ? "text-foreground" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-foreground">{m.name}</span>
                      {m.id === defaultModel && (
                        <span className="shrink-0 rounded border border-border px-1.5 text-[10px] text-subtle">{t.defaultTag}</span>
                      )}
                    </span>
                    {m.name !== m.id && <span className="block truncate font-mono text-[11px] text-subtle">{m.id}</span>}
                  </span>
                  {m.created && (
                    <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-faint">{m.created.slice(0, 10)}</span>
                  )}
                </button>
              </li>
            ))}
            {models && shown.length === 0 && !offerTyped && (
              <li className="px-3 py-2.5 text-xs text-subtle">{t.noModels}</li>
            )}
            {offerTyped && (
              <li>
                <button type="button" onClick={() => pick(typed)}
                  className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors">
                  <span className="size-3.5 shrink-0" />
                  <span className="truncate">{t.useTyped.replace("{id}", typed)}</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
