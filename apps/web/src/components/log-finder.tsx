"use client";

import { formatMicroUsd } from "@paaco/shared";
import { Search, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { StoredTrace } from "@/db/repository";

export interface LogSearchApiResponse {
  query: string;
  mode: "ai_gateway" | "deterministic";
  appliedFilter: Record<string, unknown>;
  summary: string;
  totalMatched: number;
  totalWastedMicroUsd: number;
  traces: StoredTrace[];
}

interface LogFinderProps {
  onResults: (traces: StoredTrace[], meta: LogSearchApiResponse | null) => void;
  onReset: () => void;
}

const EXAMPLE_PROMPTS = [
  "Find all ghost payments",
  "Show retry loops on Base",
  "Garbage 200 deliveries",
  "Solana wasted spend over $0.10",
];

export function LogFinder({ onResults, onReset }: LogFinderProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<LogSearchApiResponse | null>(null);

  async function runSearch(inputQuery: string) {
    const trimmed = inputQuery.trim();
    if (!trimmed) {
      setMeta(null);
      onReset();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as LogSearchApiResponse;
      setMeta(data);
      onResults(data.traces, data);
    } finally {
      setLoading(false);
    }
  }

  function clearSearch() {
    setQuery("");
    setMeta(null);
    onReset();
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111114] p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask Paaco AI Log Finder: e.g. 'Find all ghost payments on Solana over $0.10'..."
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2.5 pl-9 pr-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? "Searching..." : "Find Logs"}
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-mono text-zinc-500">Quick forensics:</span>
        {EXAMPLE_PROMPTS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => {
              setQuery(chip);
              void runSearch(chip);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:border-zinc-700 hover:text-white"
          >
            {chip}
          </button>
        ))}
      </div>

      {meta && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-950/15 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              {meta.mode === "ai_gateway" ? "AI Gateway" : "Structured NLP"}
            </span>
            <span className="text-zinc-200">{meta.summary}</span>
          </div>
          {meta.totalWastedMicroUsd > 0 && (
            <span className="font-mono font-semibold text-rose-400 tabular-nums">
              Wasted: {formatMicroUsd(meta.totalWastedMicroUsd)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
