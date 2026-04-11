// Lightweight embedding helper. Returns a 1536-dim vector for a string, or
// null if no embedding backend is configured. We keep this dependency-free
// (raw fetch) so it never blocks the build, and graceful-degrades when
// EMBEDDING_API_KEY / OPENAI_API_KEY is absent — callers (e.g. the playbook
// hybrid recall) treat null as "skip the vector channel and rely on
// keyword search". This means the platform works out of the box and
// hybrid recall lights up the moment an operator drops a key in.

import { logger } from "../middleware/logger.js";

const MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const DIM = 1536;

function readApiKey(): string | null {
  return (
    process.env.EMBEDDING_API_KEY ??
    process.env.OPENAI_API_KEY ??
    null
  );
}

let warned = false;

export async function embed(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const apiKey = readApiKey();
  if (!apiKey) {
    if (!warned) {
      logger.info(
        { service: "embeddings" },
        "no EMBEDDING_API_KEY/OPENAI_API_KEY set — vector recall disabled, falling back to keyword-only",
      );
      warned = true;
    }
    return null;
  }
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: trimmed.slice(0, 8000) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { service: "embeddings", status: res.status, body: body.slice(0, 200) },
        "embedding API call failed",
      );
      return null;
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== DIM) {
      logger.warn(
        { service: "embeddings", got: vec?.length, want: DIM },
        "embedding API returned unexpected dimensionality",
      );
      return null;
    }
    return vec;
  } catch (err) {
    logger.warn({ service: "embeddings", err }, "embedding fetch threw");
    return null;
  }
}

export const EMBEDDING_DIM = DIM;
