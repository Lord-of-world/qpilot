import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The provider config file, ~/.qpilot/config.json — the same file the CLI
// (bin/qa-agent.js) and the macOS app write. The server reads it on every
// run, so changes from the Settings page apply without a restart.
// Env vars (ANTHROPIC_API_KEY, QPILOT_*) are only the fallback when there is
// no file — see resolveProvider in lib/provider.ts.

export const QPILOT_HOME = process.env.QPILOT_HOME || join(homedir(), ".qpilot");
export const CONFIG_PATH = join(QPILOT_HOME, "config.json");

export interface StoredConfig {
  provider: "anthropic" | "custom";
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export function readConfigFile(): StoredConfig | null {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<StoredConfig>;
    if (!raw || typeof raw !== "object") return null;
    return {
      provider: raw.provider === "custom" ? "custom" : "anthropic",
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      model: typeof raw.model === "string" && raw.model ? raw.model : undefined,
      baseURL: typeof raw.baseURL === "string" && raw.baseURL ? raw.baseURL : undefined,
    };
  } catch {
    return null;
  }
}

export function writeConfigFile(cfg: StoredConfig): void {
  mkdirSync(QPILOT_HOME, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}

/** "sk-ant-api03-abc…wxyz" — enough to recognise a key, useless to steal it. */
export function maskKey(key: string): string {
  if (!key) return "";
  return key.length > 14 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "••••";
}

const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v);

/** Base URLs compared the way they are saved: trimmed, no trailing slash. */
export const sameBaseURL = (a: string | undefined, b: string | undefined) =>
  (a ?? "").trim().replace(/\/+$/, "") === (b ?? "").trim().replace(/\/+$/, "");

/**
 * The saved key may be reused only for the provider *and* base URL it was
 * saved with. Otherwise a request that merely changes the base URL could
 * make the server send the saved key to someone else's server.
 */
export function reusableKey(
  current: StoredConfig | null,
  provider: StoredConfig["provider"],
  baseURL: string | undefined,
): string {
  return current && current.provider === provider && sameBaseURL(current.baseURL, baseURL)
    ? current.apiKey
    : "";
}

/**
 * Validate what the Settings form sent. An empty apiKey keeps the current
 * key — but only while provider and base URL stay the same (see reusableKey).
 */
export function normalizeConfig(
  input: { provider?: unknown; apiKey?: unknown; model?: unknown; baseURL?: unknown },
  current: StoredConfig | null,
): StoredConfig {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const provider = input.provider === "custom" ? "custom" : "anthropic";
  const model = s(input.model);
  const baseURL = s(input.baseURL).replace(/\/+$/, "");
  const apiKey = s(input.apiKey) || reusableKey(current, provider, baseURL);

  if (!apiKey) {
    if (current?.apiKey && current.provider === provider) {
      throw new Error("Re-enter the API key to change the base URL — the saved key is only ever sent to the address it was saved with.");
    }
    throw new Error(provider === "custom" ? "API token is required" : "Anthropic API key is required");
  }
  if (baseURL && !isUrl(baseURL)) throw new Error("Base URL must start with http:// or https://");
  if (provider === "custom") {
    if (!baseURL) throw new Error("Base URL is required for an OpenAI-compatible provider");
    if (!model) throw new Error("Model id is required");
  }
  return {
    provider,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseURL ? { baseURL } : {}),
  };
}
