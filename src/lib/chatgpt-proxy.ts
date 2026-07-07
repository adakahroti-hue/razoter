// ─── ChatGPT Plus Request Translator ─────────────────
// Translates OpenAI /chat/completions format to/from
// the Codex /responses API format.

import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';

/**
 * Send a request to the Codex Responses API and translate
 * the response back to OpenAI /chat/completions format.
 */
export async function handleChatgptPlusRequest(
  accessToken: string,
  body: any,
  model: string,
  isStreaming: boolean,
): Promise<{ response: NextResponse; tokensUsed?: number }> {
  const codexUrl = 'https://chatgpt.com/backend-api/codex/responses';

  // Translate messages → input
  // Codex only supports: assistant, system, developer, user
  // Filter out unsupported roles (tool, function, etc.)
  const allowedRoles = new Set(['assistant', 'system', 'developer', 'user']);
  const input = (body.messages || [])
    .filter((m: any) => allowedRoles.has(m.role))
    .map((m: any) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

  const codexBody: any = {
    model,
    input,
    store: false,
    stream: true, // Codex always requires stream: true
  };

  const resp = await fetch(codexUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(codexBody),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return {
      response: NextResponse.json(
        { error: { message: `Codex API error: ${resp.status} ${errText}`, type: 'upstream_error' } },
        { status: resp.status }
      ),
    };
  }

  // Codex always returns streaming SSE. Translate to /chat/completions format.
  if (isStreaming) {
    // Transform Codex SSE → OpenAI /chat/completions SSE
    const transformedStream = transformCodexStreamToChatCompletions(resp.body!, model);
    return {
      response: new NextResponse(transformedStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders(),
        },
      }),
    };
  }

  // Non-streaming: collect all chunks, return as single response
  const { text, usage } = await collectCodexStream(resp.body!);
  const chatResponse = {
    id: `chatcmpl-codex-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  return {
    response: NextResponse.json(chatResponse, { status: 200 }),
    tokensUsed: usage?.total_tokens,
  };
}

/**
 * Collect all text from a Codex streaming response.
 */
async function collectCodexStream(body: ReadableStream): Promise<{ text: string; usage?: any }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let usage = null;
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(jsonStr);
        if (chunk.type === 'response.output_text.delta') {
          text += chunk.delta || '';
        } else if (chunk.type === 'response.completed') {
          const resp = chunk.response || {};
          const output = resp.output || [];
          for (const item of output) {
            if (item.type === 'message') {
              for (const c of item.content || []) {
                if (c.type === 'output_text' && c.text) {
                  text = c.text; // Use final text, not accumulated deltas
                }
              }
            }
          }
          if (resp.usage) {
            usage = {
              prompt_tokens: resp.usage.input_tokens || 0,
              completion_tokens: resp.usage.output_tokens || 0,
              total_tokens: (resp.usage.input_tokens || 0) + (resp.usage.output_tokens || 0),
            };
          }
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  return { text, usage };
}

/**
 * Transform Codex SSE stream to OpenAI /chat/completions SSE format.
 * This is a TransformStream that reads Codex events and emits chat.completion.chunk events.
 */
function transformCodexStreamToChatCompletions(
  codexBody: ReadableStream,
  model: string,
): ReadableStream {
  const reader = codexBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const chatId = `chatcmpl-codex-${Date.now()}`;

  return new ReadableStream({
    async start(controller) {
      let buffer = '';
      let sentRole = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(jsonStr);

              if (chunk.type === 'response.output_text.delta') {
                const delta: any = {};
                if (!sentRole) {
                  delta.role = 'assistant';
                  sentRole = true;
                }
                delta.content = chunk.delta || '';

                const sseChunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{
                    index: 0,
                    delta,
                    finish_reason: null,
                  }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseChunk)}\n\n`));
              } else if (chunk.type === 'response.completed') {
                // Send final chunk with finish_reason
                const finalChunk = {
                  id: chatId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: 'stop',
                  }],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              }
            } catch { /* skip malformed chunks */ }
          }
        }
      } catch (err) {
        // Stream error
      } finally {
        controller.close();
      }
    },
  });
}
