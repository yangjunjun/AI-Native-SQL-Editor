import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const MAX_SQL_LENGTH = 50_000;
const MAX_INSTRUCTION_LENGTH = 2_000;
const MAX_DIALECT_LENGTH = 80;
const MAX_REQUEST_LENGTH = 110_000;
const MAX_PROVIDER_ERROR_LENGTH = 250;

export function loadConfig(path = new URL('./.env', import.meta.url)) {
  try {
    loadEnvFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function validate(body) {
  return (
    body &&
    typeof body.sql === 'string' &&
    typeof body.instruction === 'string' &&
    typeof body.dialect === 'string' &&
    body.sql.length <= MAX_SQL_LENGTH &&
    body.instruction.trim().length > 0 &&
    body.instruction.length <= MAX_INSTRUCTION_LENGTH &&
    body.dialect.length <= MAX_DIALECT_LENGTH
  );
}

function respond(response, status, message) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function sendEvent(response, event, payload) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function readRewriteRequest(request, response) {
  let rawBody = '';
  try {
    for await (const chunk of request) {
      rawBody += chunk;
      if (rawBody.length > MAX_REQUEST_LENGTH) {
        respond(response, 413, 'Request too large');
        return null;
      }
    }
  } catch {
    respond(response, 400, 'Invalid request');
    return null;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    respond(response, 400, 'Invalid JSON');
    return null;
  }

  if (!validate(body)) {
    respond(response, 400, 'Invalid sql/instruction/dialect');
    return null;
  }
  return body;
}

function requestProviderRewrite(body, signal) {
  const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'gpt-4.1-mini',
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            `Rewrite the provided SQL according to the instruction in ${body.dialect}` +
            ' syntax. Output ONLY complete SQL, no prose or markdown. Preserve unrelated statements, and do not invent unknown schema.',
        },
        {
          role: 'user',
          content: `Instruction:\n${body.instruction}\n\nSQL:\n${body.sql}`,
        },
      ],
    }),
  });
}

async function forwardProviderStream(upstream, response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });

  const decoder = new TextDecoder();
  let buffer = '';
  let generatedSql = '';

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
    let packetEnd;
    while ((packetEnd = buffer.indexOf('\n\n')) >= 0) {
      const packet = buffer.slice(0, packetEnd);
      buffer = buffer.slice(packetEnd + 2);
      const dataLine = packet.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine || dataLine.slice(5).trim() === '[DONE]') continue;

      try {
        const payload = JSON.parse(dataLine.slice(5));
        const delta = payload.choices?.[0]?.delta?.content || '';
        if (delta) {
          generatedSql += delta;
          sendEvent(response, 'delta', { text: delta });
        }
      } catch {
        // Ignore provider events that do not contain valid JSON content.
      }
    }
  }

  if (!generatedSql.trim()) {
    sendEvent(response, 'error', { message: 'Provider returned empty SQL' });
  } else {
    sendEvent(response, 'done', {});
  }
  response.end();
}

async function handleRewrite(request, response) {
  if (!process.env.AI_API_KEY) {
    respond(response, 503, 'AI_API_KEY is not set on the Node server');
    return;
  }

  const body = await readRewriteRequest(request, response);
  if (!body) return;

  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableEnded) controller.abort();
  });

  try {
    const upstream = await requestProviderRewrite(body, controller.signal);
    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, MAX_PROVIDER_ERROR_LENGTH);
      respond(response, 502, `Provider HTTP ${upstream.status}: ${detail}`);
      return;
    }
    if (!upstream.body) {
      respond(response, 502, 'Provider response is empty');
      return;
    }
    await forwardProviderStream(upstream, response);
  } catch (error) {
    const message = error.message || 'Provider failed';
    if (!response.headersSent) {
      respond(response, 502, message);
    } else if (!response.destroyed) {
      sendEvent(response, 'error', { message });
      response.end();
    }
  }
}

export function createServer() {
  return http.createServer(async (request, response) => {
    const isEditorPage =
      request.method === 'GET' && (request.url === '/' || request.url === '/index.html');
    if (isEditorPage) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(await readFile(htmlPath));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/rewrite') {
      await handleRewrite(request, response);
      return;
    }
    respond(response, 404, 'Not found');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadConfig();
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`SQL Editor on http://localhost:${port}`));
}
