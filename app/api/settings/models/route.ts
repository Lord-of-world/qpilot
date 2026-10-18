import { NextRequest, NextResponse } from "next/server";
import { reusableKey } from "@/lib/config";
import { currentStoredConfig, listModels } from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Models available to a key, fetched live from the provider:
 * { provider, apiKey?, baseURL? }. Without apiKey the saved key is used, so
 * the list works before re-typing it — but only towards the provider and
 * base URL it was saved for, never to an address taken from the request.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const provider = body.provider === "custom" ? "custom" : "anthropic";
  const saved = currentStoredConfig()?.config ?? null;
  const baseURL = s(body.baseURL);
  const apiKey = s(body.apiKey) || reusableKey(saved, provider, baseURL);

  if (!apiKey) {
    const changedUrl = saved?.apiKey && saved.provider === provider;
    return NextResponse.json(
      { error: changedUrl ? "Re-enter the API key to load models from a different base URL." : "Enter an API key to load the models." },
      { status: 400 },
    );
  }
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
