import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __PELICAN_GAME__?: {
      phase: string;
      input: { read(): { steer: number; throttle: number; brake: number; boost: boolean } };
    };
  }
}

test('title starts, HUD updates and keyboard intents reach the game', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (document.querySelector('[data-action="start"]') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(async () => page.evaluate(() => window.__PELICAN_GAME__?.phase), { timeout: 15000 })
    .toBe('playing');
  await expect(page.locator('#hud-root')).toHaveAttribute('data-phase', 'playing', {
    timeout: 15000,
  });
  await expect(page.locator('#lap-value')).toHaveText('01');

  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => page.evaluate(() => window.__PELICAN_GAME__?.input.read().throttle))
    .toBe(1);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD');
  await expect
    .poll(async () => page.evaluate(() => window.__PELICAN_GAME__?.input.read().steer))
    .toBe(1);
  await page.keyboard.up('KeyD');

  await page.keyboard.press('KeyP');
  await expect(page.locator('#hud-root')).toHaveAttribute('data-phase', 'paused');
  await page.evaluate(() => {
    (document.querySelector('[data-action="resume"]') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(async () => page.evaluate(() => window.__PELICAN_GAME__?.phase), { timeout: 15000 })
    .toBe('playing');
});

test('capture states drive weather, clock and end screens', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('night'));
  await expect(page.locator('#weather-label')).toHaveText('晴朗');
  await expect(page.locator('#clock-value')).toContainText('21:');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('storm'));
  await expect(page.locator('#weather-label')).toHaveText('雷暴');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('finished'));
  await expect(page.locator('#hud-root')).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('.screen-finish')).toBeVisible();

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.setState('crashed'));
  await expect(page.locator('.screen-crash')).toBeVisible();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-phase', 'crashed');
});

test('camera button cycles chase, side, front and orbit views', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    (document.querySelector('[data-action="start"]') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(async () => page.evaluate(() => window.__PELICAN_GAME__?.phase), { timeout: 15000 })
    .toBe('playing');
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'chase');
  const clickCamera = () =>
    page.evaluate(() => (document.querySelector('#camera-button') as HTMLButtonElement | null)?.click());
  await clickCamera();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'side');
  await clickCamera();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'front');
  await clickCamera();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'orbit');
  await clickCamera();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'pelican');
  await clickCamera();
  await expect(page.locator('#hud-root')).toHaveAttribute('data-camera', 'chase');
});
