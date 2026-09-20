/**
 * The `Provider` seam, implemented with `@google/genai`.
 *
 * The only file in the repository that imports the vendor SDK. Everything
 * above it — the writer, the fidelity check, wave 6, wave 7 — sees the
 * interface in `provider.ts` and a stub in tests, so none of them needs a key
 * or a network to be exercised.
 *
 * **Which API surface.** Google now documents `client.interactions.create`
 * with a top-level `response_format` and says it is "recommended for all new
 * development", while `generateContent` "remains fully supported" with no
 * end-of-support date. This uses `generateContent`, on purpose: it can be
 * checked against the installed `genai.d.ts` line by line without spending a
 * call, and there is no way to test the other one here without one.
 * Specifically `GenerateContentConfig` declares `abortSignal` (:4549),
 * `systemInstruction` (:4554), `temperature` (:4560), `responseMimeType`
 * (:4613) and `responseJsonSchema` (:4640) in 2.6.0, which is every field
 * used below. When wave 7 has a key in hand, moving to Interactions is a
 * change to this file alone.
 *
 * **`responseJsonSchema`, not `responseSchema`.** The first takes ordinary
 * JSON Schema — which is what `skin/schema.ts` and the seventeen clue modules
 * already produce — and the SDK's own doc comment says the two are mutually
 * exclusive and that `responseMimeType` is required alongside it.
 */

import { GoogleGenAI } from "@google/genai";
import { LlmError } from "./errors";
import {
  type ImageCall,
  type ImageResult,
  type JsonCall,
  type KeySource,
  type Provider,
  parseJson,
  requireKey,
} from "./provider";
import { DEFAULT_IMAGE_MODEL, WRITER_MODEL } from "./models";

export interface GeminiOptions {
  /** Where the key comes from, asked once per request. */
  key: KeySource;
  /** Used when a call does not name one. */
  model?: string;
  /** Per-request ceiling. The writer's call is long; 90s is not generous. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 90_000;

export function geminiProvider(options: GeminiOptions): Provider {
  const defaultModel = options.model ?? WRITER_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "gemini",

    async generateJSON(call: JsonCall): Promise<unknown> {
      // Asked here rather than held in a closure: nothing in this module ever
      // owns the key for longer than one request (invariant 9).
      const apiKey = requireKey(options.key);
      const ai = new GoogleGenAI({ apiKey });
      const signal = deadline(timeoutMs, call.signal);

      let text: string | undefined;
      try {
        const response = await ai.models.generateContent({
          model: call.model ?? defaultModel,
          contents: [{ role: "user", parts: [{ text: call.user }] }],
          config: {
            systemInstruction: call.system,
            responseMimeType: "application/json",
            responseJsonSchema: call.schema,
            temperature: call.temperature,
            // Client-side only, per the SDK's own note: it stops us waiting,
            // it does not stop the far end working, and the call is still
            // billed. Worth knowing before a cancel button is read as a
            // refund.
            abortSignal: signal,
          },
        });
        text = response.text;
      } catch (cause) {
        throw LlmError.from(cause);
      }

      if (text === undefined || text.trim() === "") {
        // An empty body with no thrown error is what a safety block looks
        // like from here: the request succeeded and there is no candidate.
        throw new LlmError("blocked", "the model returned no text");
      }
      return parseJson(text);
    },

    /**
     * Wave 7's, sitting here so that the seam does not move when art lands.
     *
     * Shaped after `../catalog-art/api.mjs#generateImage`, which is the call
     * that demonstrably works on this machine, translated from its REST form
     * to the SDK's. **Unexercised**: no image has been generated through this
     * path, and wave 7 should treat it as a draft rather than as working code.
     */
    async generateImage(call: ImageCall): Promise<ImageResult> {
      const apiKey = requireKey(options.key);
      const ai = new GoogleGenAI({ apiKey });
      const signal = deadline(timeoutMs, call.signal);

      try {
        const response = await ai.models.generateContent({
          model: call.model ?? DEFAULT_IMAGE_MODEL,
          contents: [{ role: "user", parts: [{ text: call.prompt }] }],
          config: {
            responseModalities: ["IMAGE"],
            ...(call.aspect ? { imageConfig: { aspectRatio: call.aspect } } : {}),
            abortSignal: signal,
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          const data = part.inlineData?.data;
          if (typeof data === "string" && data !== "") {
            return {
              mime: part.inlineData?.mimeType ?? "image/png",
              bytes: base64Bytes(data),
            };
          }
        }
        throw new LlmError("blocked", "the model returned no image");
      } catch (cause) {
        throw LlmError.from(cause);
      }
    },
  };
}

/**
 * One signal that fires on the caller's cancel or on the timeout.
 *
 * `AbortSignal.any` is in Node 22 and in every browser this ships to; the
 * fallback is there because a service worker context that lacks it should
 * degrade to "no timeout" rather than to "no generation".
 */
function deadline(ms: number, caller?: AbortSignal): AbortSignal | undefined {
  const timeout = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
  if (!timeout) return caller;
  if (!caller) return timeout;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([caller, timeout]) : caller;
}

function base64Bytes(base64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  // Node, for the authoring CLI.
  return new Uint8Array(Buffer.from(base64, "base64"));
}
