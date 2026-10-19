import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { sha256, type Slot } from "@sme/core";
import { copySchema, placeholderProvider, seedFrom, writeCopy, type BrandContext, type CopyVariant } from "../src";

const brand: BrandContext = {
  name: "ISMII", readme: "# Brand", sections: [{ title: "Voice", markdown: "Speak as we." }], voice: "Speak as we.", extraVoice: "",
  bannedWords: ["unprecedented"], language: "English", hashtags: [], maxHashtags: 3, imageStyle: "natural light",
};
const slots: Slot[] = [
  { name: "title", label: "Title", type: "text", description: "", required: true, maxChars: 20 },
  { name: "photo", label: "Photo", type: "image", description: "", required: true },
];

/** A fake client that returns queued JSON answers and records requests. */
function fakeClient(answers: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: Record<string, unknown>) => {
          requests.push(structuredClone(req));
          const next = answers.shift();
          return {
            model: req.model, stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(next) }],
            usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const variant = (title: string): CopyVariant => ({ slots: { title }, imagePrompts: { photo: "a reading room" }, caption: "c", hashtags: [], altText: "a", sourceUrls: ["https://x.org/a", "https://evil.example"] });

describe("copywriter", () => {
  it("builds a strict schema from template slots", () => {
    const s = copySchema({ id: "t", name: "T", description: "", slots }) as any;
    const v = s.properties.variants.items;
    expect(v.properties.slots.required).toEqual(["title"]);
    expect(v.properties.imagePrompts.required).toEqual(["photo"]);
    expect(v.additionalProperties).toBe(false);
  });

  it("validates, asks for a fix, and keeps only provided sources", async () => {
    const { client, requests } = fakeClient([{ variants: [variant("This title is far too long to fit")] }, { variants: [variant("Short title")] }]);
    const res = await writeCopy({
      client, brand, template: { id: "t", name: "T", description: "", slots }, brief: "b", variants: 1, platforms: ["instagram"],
      knowledge: [{ url: "https://x.org/a", title: "A", text: "text" }],
      validate: (v) => ((v.slots.title as string).length > 20 ? ["Title is too long"] : []),
    });
    expect(res.attempts).toBe(2);
    expect(res.variants[0].slots.title).toBe("Short title");
    expect(res.variants[0].sourceUrls).toEqual(["https://x.org/a"]);
    // second request appends the assistant turn and the feedback (append-only history)
    const second = requests[1] as { messages: { role: string; content: unknown }[]; system: { text: string; cache_control: unknown }[]; output_config: unknown; fallbacks: unknown };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(String(second.messages[2].content)).toMatch(/Title is too long/);
    expect(second.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(second.fallbacks).toBe("default");
    expect(second.system[0].text).toContain("unprecedented");
  });
});

describe("images", () => {
  it("placeholder provider is deterministic per seed", async () => {
    const req = { prompt: "x", width: 400, height: 300, seed: seedFrom("post-1:photo"), n: 2, palette: ["#9e3d22", "#f4efe6"] };
    const a = await placeholderProvider.generate(req, undefined);
    const b = await placeholderProvider.generate(req, undefined);
    expect(a.images.map((i) => sha256(i.bytes))).toEqual(b.images.map((i) => sha256(i.bytes)));
    expect(sha256(a.images[0].bytes)).not.toBe(sha256(a.images[1].bytes));
  });
});
