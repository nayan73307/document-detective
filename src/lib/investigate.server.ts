import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type ModelMessage } from "ai";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
const RUN_ID = "X-Lovable-AIG-Run-ID";

const DocSchema = z.object({
  name: z.string(),
  kind: z.enum(["pdf", "image", "text"]),
  mime: z.string(),
  data: z.string(), // base64 for pdf, data URL for image, raw text for text
});
const BodySchema = z.object({
  question: z.string().min(1),
  docs: z.array(DocSchema).min(1),
  history: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
});

const SYSTEM = `You are a meticulous document investigator. Answer the user's question using ONLY the provided documents.
Information may be scattered across files — combine it. Cite every claim with markers like [1], [2].
If the documents do not contain the answer, say so plainly.
Respond in EXACTLY this format:
<answer text with [n] markers, concise, plain text>
---SOURCES---
[{"n":1,"file":"<exact file name>","location":"<page/section/line if known>","quote":"<short verbatim excerpt>"}]`;

export async function handleInvestigate(request: Request) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return Response.json({ error: "AI is not configured." }, { status: 500 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const content: Array<Record<string, unknown>> = [];
  body.docs.forEach((d, i) => {
    content.push({ type: "text", text: `=== Document ${i + 1}: "${d.name}" (${d.kind}) ===` });
    if (d.kind === "text") content.push({ type: "text", text: d.data.slice(0, 200_000) });
    else if (d.kind === "pdf")
      content.push({ type: "file", filename: d.name, data: d.data, mediaType: "application/pdf" });
    else content.push({ type: "image", image: new URL(d.data) });
  });
  const hist = body.history
    .slice(-4)
    .map((h) => `Q: ${h.q}\nA: ${h.a}`)
    .join("\n\n");
  content.push({
    type: "text",
    text: `${hist ? `Earlier in this investigation:\n${hist}\n\n` : ""}Question: ${body.question}`,
  });

  let runId: string | undefined;
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(RUN_ID, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(RUN_ID) ?? undefined;
      if (!res.ok) lastStatus = res.status;
      return res;
    },
  });
  let lastStatus = 0;

  const messages = [{ role: "user", content }] as unknown as ModelMessage[];
  try {
    const result = streamText({
      model: provider.responses(MODEL),
      system: SYSTEM,
      messages,
      abortSignal: request.signal,
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const text = await result.text;
    if (!text.trim()) return Response.json({ error: "No answer was returned." }, { status: 502 });
    const [answer, rawSources] = text.split("---SOURCES---");
    let sources: unknown[] = [];
    try {
      const m = rawSources?.match(/\[[\s\S]*\]/);
      if (m) sources = JSON.parse(m[0]);
    } catch {
      sources = [];
    }
    return Response.json({ answer: answer.trim(), sources });
  } catch (e) {
    const status = lastStatus || 500;
    const msg =
      status === 402
        ? "AI credits are used up. Add credits in workspace billing to keep investigating."
        : status === 429
          ? "Too many requests right now. Please wait a moment and try again."
          : status === 403
            ? "Access to the AI service was denied."
            : e instanceof Error
              ? e.message
              : "Something went wrong.";
    return Response.json({ error: msg }, { status });
  }
}
