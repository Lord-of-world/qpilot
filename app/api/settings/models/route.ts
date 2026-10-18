import { NextRequest, NextResponse } from "next/server";
import { currentStoredConfig, listModels } from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Models available to a key, fetched live from the provider:
 * { provider, apiKey?, baseURL? }. Without apiKey the saved key is used —
 * if it belongs to the same provider — so the list works before re-typing it.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const provider = body.provider === "custom" ? "custom" : "anthropic";
  const saved = currentStoredConfig()?.config;
  const apiKey = s(body.apiKey) || (saved?.provider === provider ? saved.apiKey : "");
  const baseURL = s(body.baseURL);

  if (!apiKey) return NextResponse.json({ error: "Enter an API key to load the models." }, { status: 400 });
  if (provider === "custom" && !baseURL) {
    return NextResponse.json({ error: "Enter the base URL to load the models." }, { status: 400 });
  }
  if (baseURL && !/^https?:\/\//.test(baseURL)) {
    return NextResponse.json({ error: "Base URL must start with http:// or https://" }, { status: 400 });
  }
  try {
    const models = await listModels({ provider, apiKey, baseURL: baseURL || undefined });
    return NextResponse.json({ models });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
