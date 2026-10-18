import { NextRequest, NextResponse } from "next/server";
import { CONFIG_PATH, maskKey, normalizeConfig, writeConfigFile } from "@/lib/config";
import {
  DEFAULT_ANTHROPIC_MODEL,
  currentStoredConfig,
  providerConfigError,
  toProviderConfig,
} from "@/lib/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the Settings page shows. The API key itself never leaves the server. */
function publicSettings() {
  const current = currentStoredConfig();
  const cfg = current?.config;
  return {
    provider: cfg?.provider ?? "anthropic",
    model: cfg?.model ?? "",
    baseURL: cfg?.baseURL ?? "",
    hasKey: Boolean(cfg?.apiKey),
    keyHint: maskKey(cfg?.apiKey ?? ""),
    source: current?.source ?? "none",
    configured: cfg ? providerConfigError(toProviderConfig(cfg)) === null : false,
    configPath: CONFIG_PATH,
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
  };
}

export async function GET() {
  return NextResponse.json(publicSettings());
}

/** Save the provider: { provider, apiKey? (empty keeps the saved one), model?, baseURL? }. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    writeConfigFile(normalizeConfig(body, currentStoredConfig()?.config ?? null));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json(publicSettings());
}
