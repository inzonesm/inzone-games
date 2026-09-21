/**
 * Official OpenAI chat completions SSE parser.
 * https://platform.openai.com/docs/api-reference/chat/create — stream: true
 */

export type OpenAiStreamResult = {
  text: string;
  firstTokenMs: number | null;
};

export function parseOpenAiSseLine(line: string): string | null | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('data:')) return undefined;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return null;
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const piece = json.choices?.[0]?.delta?.content;
    return typeof piece === 'string' ? piece : undefined;
  } catch {
    return undefined;
  }
}

export async function streamOpenAiChat(input: {
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  signal?: AbortSignal;
  onFirstToken?: (at: number) => void;
}): Promise<OpenAiStreamResult | null> {
  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.modelId,
      temperature: 0.4,
      max_tokens: input.maxTokens,
      stream: true,
      messages: input.messages,
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let firstTokenMs: number | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const piece = parseOpenAiSseLine(line);
      if (piece === null) {
        return { text: text.replace(/\s+/g, ' ').trim(), firstTokenMs };
      }
      if (typeof piece === 'string' && piece) {
        if (firstTokenMs == null) {
          firstTokenMs = Date.now() - started;
          input.onFirstToken?.(Date.now());
        }
        text += piece;
      }
    }
  }
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean ? { text: clean, firstTokenMs } : null;
}
