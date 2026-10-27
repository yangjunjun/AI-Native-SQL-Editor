import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer, validate, loadConfig } from './server.mjs';

async function configFixture(t, content) {
  const directory = await mkdtemp(join(tmpdir(), 'sql-editor-env-'));
  const path = join(directory, '.env');
  const keys = ['AI_API_KEY', 'AI_MODEL', 'AI_BASE_URL', 'PORT'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(async () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  });
  if (content !== undefined) await writeFile(path, content);
  return path;
}

test('loads quoted AI configuration, comments and CRLF from .env', async (t) => {
  const path = await configFixture(
    t,
    '# AI settings\r\nAI_API_KEY="test-key=#value"\r\nAI_MODEL=\'test-model\'\r\nAI_BASE_URL=https://example.test/v1 # provider\r\nPORT=3107\r\n',
  );
  loadConfig(path);
  assert.equal(process.env.AI_API_KEY, 'test-key=#value');
  assert.equal(process.env.AI_MODEL, 'test-model');
  assert.equal(process.env.AI_BASE_URL, 'https://example.test/v1');
  assert.equal(process.env.PORT, '3107');
});

test('existing environment values take precedence over .env', async (t) => {
  const path = await configFixture(t, 'AI_API_KEY=file-key\nAI_MODEL=file-model\n');
  process.env.AI_API_KEY = 'shell-key';
  process.env.AI_MODEL = '';
  loadConfig(path);
  assert.equal(process.env.AI_API_KEY, 'shell-key');
  assert.equal(process.env.AI_MODEL, '');
});

test('missing .env is optional; invalid arguments are reported', async (t) => {
  const path = await configFixture(t);
  assert.doesNotThrow(() => loadConfig(path));
  assert.equal(process.env.AI_API_KEY, undefined);
  assert.throws(
    () => loadConfig(42),
    (error) => error.code === 'ERR_INVALID_ARG_TYPE',
  );
});

test('.env AI settings are forwarded to the configured provider', async (t) => {
  let received;
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(
      'data: ' +
        JSON.stringify({ choices: [{ delta: { content: 'SELECT 2;' } }] }) +
        '\n\ndata: [DONE]\n\n',
    );
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => provider.close(resolve)));
  const path = await configFixture(
    t,
    `AI_API_KEY="fixture-key"\nAI_MODEL="fixture-model"\nAI_BASE_URL="http://127.0.0.1:${provider.address().port}/custom/v1/"\n`,
  );
  loadConfig(path);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/rewrite`, {
    method: 'POST',
    body: JSON.stringify({ sql: 'SELECT 1', instruction: 'rewrite', dialect: 'MySQL' }),
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /SELECT 2;/);
  assert.equal(received.url, '/custom/v1/chat/completions');
  assert.equal(received.authorization, 'Bearer fixture-key');
  assert.equal(received.body.model, 'fixture-model');
});
test('request validation', () => {
  assert.equal(validate({ sql: 'SELECT 1', instruction: 'add a filter', dialect: 'MySQL' }), true);
  assert.equal(validate({ sql: 'SELECT 1', instruction: '', dialect: 'MySQL' }), false);
  assert.equal(
    validate({ sql: 'x'.repeat(50001), instruction: 'modify', dialect: 'MySQL' }),
    false,
  );
});

test('HTTP routes and invalid rewrite requests keep their existing responses', async (t) => {
  await configFixture(t);
  process.env.AI_API_KEY = 'fixture-key';
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const page = await fetch(`${baseUrl}/index.html`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AI Native SQL Editor/);

  const invalidRequests = [
    { path: '/missing', method: 'GET', status: 404, message: 'Not found' },
    { path: '/api/rewrite', method: 'GET', status: 404, message: 'Not found' },
    { path: '/api/rewrite', method: 'POST', body: '{', status: 400, message: 'Invalid JSON' },
    {
      path: '/api/rewrite',
      method: 'POST',
      body: '{}',
      status: 400,
      message: 'Invalid sql/instruction/dialect',
    },
    {
      path: '/api/rewrite',
      method: 'POST',
      body: 'x'.repeat(110001),
      status: 413,
      message: 'Request too large',
    },
  ];
  for (const { path, method, body, status, message } of invalidRequests) {
    const response = await fetch(baseUrl + path, { method, body });
    assert.equal(response.status, status);
    assert.equal(await response.text(), message);
  }
});

test('local proxy fails closed without API key', async () => {
  const saved = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const r = await fetch('http://127.0.0.1:' + port + '/api/rewrite', {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1', instruction: 'rewrite', dialect: 'MySQL' }),
    });
    assert.equal(r.status, 503);
    assert.match(await r.text(), /AI_API_KEY/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (saved !== undefined) process.env.AI_API_KEY = saved;
  }
});
