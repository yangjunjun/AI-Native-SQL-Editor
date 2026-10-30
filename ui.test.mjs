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
    const compactLayout = await page.evaluate(() => {
      const card = document.querySelector('.review-card');
      const message = card?.querySelector('.review-message');
      const undoButton = card?.querySelector('.secondary');
      const keepButton = card?.querySelector('.keep');
      if (!card || !message || !undoButton || !keepButton) return null;
      const bar = card.getBoundingClientRect();
      const left = message.getBoundingClientRect();
      const undo = undoButton.getBoundingClientRect();
      const keep = keepButton.getBoundingClientRect();
      return {
        label: message.textContent,
        cardHeight: bar.height,
        sameRow: Math.abs((left.top + left.bottom)/2 - (undo.top + undo.bottom)/2) < 6 &&
          Math.abs((left.top + left.bottom)/2 - (keep.top + keep.bottom)/2) < 6,
        order: left.right < undo.left && undo.right < keep.left,
        hasDescription: !!card.querySelector('p')
      };
    });
    assert.ok(compactLayout, 'confirmation components must render');
    assert.match(compactLayout.label, /变更已完成，请确认是否采纳/);
    assert.ok(compactLayout.cardHeight <= 52, 'confirmation must be compact: ' + JSON.stringify(compactLayout));
    assert.ok(compactLayout.sameRow && compactLayout.order, 'message and buttons must share one row in order');
    assert.equal(compactLayout.hasDescription, false, 'success bar should not include a second line');
    // Regression: the review must start at the Monaco line-number gutter and
    // touch the edited SQL hunk, not float near the original selection start.
    const geometry = await page.evaluate(() => {
      const zoneNode = document.querySelector('.review-zone');
      const review = document.querySelector('.review-card')?.getBoundingClientRect();
      const zone = zoneNode?.getBoundingClientRect();
      const code = document.querySelector('.monaco-editor .view-line')?.getBoundingClientRect();
      const changed = document.querySelector('.monaco-editor .ai-added-line')?.getBoundingClientRect();
      if (!review || !zone || !code || !changed) return null;
      const styles = getComputedStyle(zoneNode);
      return {
        leftOffset: review.left - code.left,
        gapAfterChange: review.top - changed.bottom,
        topInset: review.top - zone.top,
        bottomInset: zone.bottom - review.bottom,
        paddingTop: styles.paddingTop,
        paddingBottom: styles.paddingBottom,
      };
    });
    assert.ok(geometry, 'review, SQL content, and changed line must exist');
    assert.ok(Math.abs(geometry.leftOffset) <= 8,
      'review must align with the SQL content column: ' + JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.gapAfterChange - 6) <= 8,
      'review should follow edited SQL with 6px gap: ' + JSON.stringify(geometry));
    assert.equal(geometry.paddingTop, '6px');
    assert.equal(geometry.paddingBottom, '6px');
    assert.ok(Math.abs(geometry.topInset - 6) <= 2 && Math.abs(geometry.bottomInset - 6) <= 2,
      'review zone must have 6px top and bottom margins: ' + JSON.stringify(geometry));
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
