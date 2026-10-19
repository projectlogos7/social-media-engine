import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_COPY_MODEL = "claude-opus-5-5";

export class RefusalError extends Error {}

export function anthropicClient(apiKey?: string): Anthropic {
  return new Anthropic(apiKey ? { apiKey } : {});
}

export interface JsonCallOptions {
  client: Anthropic;
  model?: string;
  /** Stable brand context; cached across calls for the same project. */
  system: string;
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface JsonCallResult<T> {
  data: T;
  raw: string;
  /** The assistant turn, to append when asking for a revision. */
  assistant: Anthropic.Beta.Messages.BetaMessageParam;
  usage: { input: number; output: number; cacheRead: number };
  model: string;
}

/** One structured-output call. Refusals fall back server-side; a final refusal throws. */
export async function callJson<T>(o: JsonCallOptions): Promise<JsonCallResult<T>> {
  const response = await o.client.beta.messages.create({
    model: o.model ?? DEFAULT_COPY_MODEL,
    max_tokens: o.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: o.messages,
    output_config: { effort: o.effort ?? "medium", format: { type: "json_schema", schema: o.schema } },
  });
  if (response.stop_reason === "refusal") throw new RefusalError("The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("The response was cut off before it finished.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error("The model returned output that is not valid JSON.");
  }
  return {
    data,
    raw: text,
    assistant: { role: "assistant", content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[] },
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, cacheRead: response.usage.cache_read_input_tokens ?? 0 },
    model: response.model,
  };
}
