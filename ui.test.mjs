import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from './server.mjs';

test('Inline Edit review and error buttons receive real browser clicks', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('.monaco-editor').waitFor({timeout: 25000});

    async function request(instruction) {
      await page.locator('#open').click();
      const input = page.locator('.inline-chat textarea');
      await input.waitFor();
      await input.fill(instruction);
      await page.locator('.inline-chat .generate').click();
    }

    await request('增加最近30天过滤条件');
    const keep = page.locator('.review-card .keep');
    await keep.waitFor({state: 'visible'});
    await keep.click({timeout: 6000});
    assert.match(await page.locator('#status').textContent(), /已保留 AI 修改/);

    await request('增加最近7天过滤条件');
    const undo = page.locator('.review-card .secondary');
    await undo.waitFor({state: 'visible'});
    await undo.click({timeout: 6000});
    assert.match(await page.locator('#status').textContent(), /已撤销 AI 修改/);

    await request('模拟失败');
    const close = page.locator('.error-card .secondary');
    await close.waitFor({state: 'visible'});
    await close.click({timeout: 6000});
    assert.match(await page.locator('#status').textContent(), /失败/);
  } finally {
    await page.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
