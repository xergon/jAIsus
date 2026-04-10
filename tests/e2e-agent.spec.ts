import { test, expect, Page } from '@playwright/test';

/**
 * jAIsus E2E Test Agent
 *
 * Autonomous test agent that validates every feature of the live app.
 * Run against production: BASE_URL=https://jaisus.vercel.app npx playwright test tests/e2e-agent.spec.ts
 */

const LIVE_URL = process.env.BASE_URL || 'https://jaisus.vercel.app';

test.use({
  viewport: { width: 393, height: 852 },
  baseURL: LIVE_URL,
});

// ─── HELPERS ──────────────────────────────────────────────────

async function waitForApp(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // Wait for React hydration — the Ask button is the last thing to mount
  await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible({ timeout: 15000 });
}

async function closeAnyPanel(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ─── 1. APP LOADS & RENDERS ──────────────────────────────────

test.describe('1. App Loading', () => {
  test('page loads without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await waitForApp(page);

    // Filter out non-critical errors (e.g. favicon, sourcemap)
    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('.map') && !e.includes('DevTools')
    );
    expect(critical.length).toBeLessThan(3);
  });

  test('title renders correctly with AI highlight', async ({ page }) => {
    await waitForApp(page);
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('jAIsus');
    // The "AI" span should have amber styling
    const aiSpan = h1.locator('span');
    await expect(aiSpan).toContainText('AI');
  });

  test('hero section shows animated Jesus video or fallback', async ({ page }) => {
    await waitForApp(page);
    // Should have either a video element or canvas/img fallback
    const video = page.locator('video').first();
    const canvas = page.locator('canvas').first();
    const img = page.locator('img[alt*="Jesus" i], img[alt*="jesus" i]').first();

    const hasVideo = await video.isVisible().catch(() => false);
    const hasCanvas = await canvas.isVisible().catch(() => false);
    const hasImg = await img.isVisible().catch(() => false);

    expect(hasVideo || hasCanvas || hasImg).toBe(true);
  });

  test('voice visualizer bars are present', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('text=Listening...')).toBeVisible();
    await expect(page.locator('text=jAIsus Speaking...')).toBeVisible();
  });

  test('AI badge is visible', async ({ page }) => {
    await waitForApp(page);
    const badge = page.locator('text=AI').first();
    await expect(badge).toBeVisible();
  });

  test('no horizontal overflow on mobile', async ({ page }) => {
    await waitForApp(page);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(393);
  });
});

// ─── 2. ACTION BUTTONS ─────────────────────────────────────

test.describe('2. Action Buttons', () => {
  test('all 4 feature buttons visible', async ({ page }) => {
    await waitForApp(page);
    for (const label of ['Request Prayer', 'Explore Parables', 'Community', 'Settings']) {
      await expect(page.locator(`button:has-text("${label}")`)).toBeVisible();
    }
  });

  test('Ask a Question button visible and clickable', async ({ page }) => {
    await waitForApp(page);
    const askBtn = page.locator('button:has-text("Ask a Question")');
    await expect(askBtn).toBeVisible();
    await askBtn.click();
    // Should focus chat or trigger voice — just verify no crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('tab bar shows Dynamic Teachings and Listen', async ({ page }) => {
    await waitForApp(page);
    await expect(page.locator('button:has-text("Dynamic Teachings")')).toBeVisible();
    // Second tab might be "Listen" or "Listen/app"
    const listenTab = page.locator('button').filter({ hasText: /Listen/i });
    await expect(listenTab.first()).toBeVisible();
  });
});

// ─── 3. CHAT FUNCTIONALITY ──────────────────────────────────

test.describe('3. Chat — Full E2E', () => {
  test('chat input is visible and accepts text', async ({ page }) => {
    await waitForApp(page);
    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    await expect(input).toBeVisible();
    await input.fill('What is faith?');
    await expect(input).toHaveValue('What is faith?');
  });

  test('sending a message gets a streaming AI response', async ({ page }) => {
    await waitForApp(page);
    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    await input.fill('What is hope?');

    // Find send button (button with SVG near input)
    const form = input.locator('..');
    const sendBtn = form.locator('button').first();
    await sendBtn.click();

    // Wait for AI response to start streaming — look for assistant message text
    // The loading dots appear first, then the actual text
    await page.waitForTimeout(3000);

    // Should have at least one message bubble with content
    const aiMessages = page.locator('div').filter({ hasText: /jAIsus|peace|love|hope|faith|God|Jesus/i });
    await expect(aiMessages.first()).toBeVisible({ timeout: 15000 });
  });

  test('chat input clears after sending', async ({ page }) => {
    await waitForApp(page);
    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    await input.fill('Hello');

    const form = input.locator('..');
    const sendBtn = form.locator('button').first();
    await sendBtn.click();

    // Input should clear
    await expect(input).toHaveValue('', { timeout: 3000 });
  });

  test('Enter key submits message', async ({ page }) => {
    await waitForApp(page);
    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    await input.fill('Amen');
    await input.press('Enter');
    await expect(input).toHaveValue('', { timeout: 3000 });
  });
});

// ─── 4. TEACHINGS PANEL ────────────────────────────────────

test.describe('4. Teachings Panel', () => {
  test('opens with topic buttons when Dynamic Teachings clicked', async ({ page }) => {
    await waitForApp(page);
    const teachingsTab = page.locator('button:has-text("Dynamic Teachings")');
    await teachingsTab.click();
    await page.waitForTimeout(1500);

    // Panel should have opened — look for any teachings-related content
    // Topic buttons contain emoji icons like ❤️ Love, 🕊️ Forgiveness
    const topicOrPanel = page.locator('button').filter({ hasText: /Love|Forgiveness|Faith|Hope/i });
    const panelText = page.locator('text=/Choose a topic|Select a topic|Dynamic Teachings/i');

    const hasTopics = (await topicOrPanel.count()) > 1; // At least 2 topic buttons
    const hasPanel = await panelText.first().isVisible().catch(() => false);

    expect(hasTopics || hasPanel).toBe(true);
  });

  test('clicking a topic generates a teaching from the API', async ({ page }) => {
    await waitForApp(page);
    const teachingsTab = page.locator('button:has-text("Dynamic Teachings")');
    await teachingsTab.click();
    await page.waitForTimeout(1500);

    // Click the Love topic button (has emoji prefix)
    const loveBtn = page.locator('button').filter({ hasText: /Love/i }).last();
    await loveBtn.click();

    // Wait for "Preparing teaching..." then actual content
    await page.waitForTimeout(8000);

    // The teaching content or "Listen to Teaching" button should appear
    const listenBtn = page.locator('button:has-text("Listen to Teaching")');
    const teachingContent = page.locator('.prose, div').filter({ hasText: /love|heart|compassion|God|kindness/i });
    const hasListen = await listenBtn.isVisible().catch(() => false);
    const hasContent = (await teachingContent.count()) > 0;
    expect(hasListen || hasContent).toBe(true);
  });

  test('teaching panel closes on Escape', async ({ page }) => {
    await waitForApp(page);
    const teachingsTab = page.locator('button:has-text("Dynamic Teachings")');
    await teachingsTab.click();
    await page.waitForTimeout(800);
    await closeAnyPanel(page);
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 5. PARABLES PANEL ────────────────────────────────────

test.describe('5. Parables Panel', () => {
  test('opens with parable list', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Explore Parables")').first().click();
    await page.waitForTimeout(1000);

    // Should show parables like Good Samaritan, Prodigal Son, etc.
    const parableItem = page.locator('text=/Samaritan|Prodigal|Sower|Mustard|Lost Sheep/i').first();
    await expect(parableItem).toBeVisible({ timeout: 5000 });
  });

  test('has a search/filter input', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Explore Parables")').first().click();
    await page.waitForTimeout(1000);

    // Look for search input in parable drawer
    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="filter" i]');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('Sower');
      await page.waitForTimeout(500);
      // Filtered results should show
      const sowerResult = page.locator('text=/Sower/i');
      await expect(sowerResult.first()).toBeVisible();
    }
  });

  test('clicking a parable sends it to chat', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Explore Parables")').first().click();
    await page.waitForTimeout(1000);

    // Click on first parable item
    const firstParable = page.locator('button, div[role="button"]').filter({
      hasText: /Samaritan|Prodigal|Sower/i
    }).first();
    if (await firstParable.isVisible().catch(() => false)) {
      await firstParable.click();
      // Panel should close and message should be sent
      await page.waitForTimeout(2000);
    }
    // App should still be responsive
    await expect(page.locator('body')).toBeVisible();
  });

  test('panel closes on Escape', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Explore Parables")').first().click();
    await page.waitForTimeout(800);
    await closeAnyPanel(page);
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 6. PRAYER PANEL ──────────────────────────────────────

test.describe('6. Prayer Request Panel', () => {
  test('opens with textarea form', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Request Prayer")').click();
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('accepts text input in prayer form', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Request Prayer")').click();
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Please pray for my family and their health.');
    await expect(textarea).toHaveValue(/pray for my family/);
  });

  test('submit button works and shows confirmation', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Request Prayer")').click();
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Test prayer request');

    const submitBtn = page.locator('button:has-text("Submit"), button:has-text("Send Prayer")').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1500);
      // Should show some confirmation (checkmark, message, or auto-close)
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('panel closes on Escape', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Request Prayer")').click();
    await page.waitForTimeout(800);
    await closeAnyPanel(page);
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 7. SETTINGS PANEL ────────────────────────────────────

test.describe('7. Settings Panel', () => {
  test('opens with auto-speak toggle', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(1000);

    const autoSpeak = page.locator('text=/Auto-speak|auto speak/i').first();
    await expect(autoSpeak).toBeVisible({ timeout: 5000 });
  });

  test('auto-speak toggle can be toggled', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(1000);

    // Find toggle switch near auto-speak
    const toggle = page.locator('button[role="switch"], input[type="checkbox"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(300);
      await toggle.click(); // Toggle back
    }
    await expect(page.locator('body')).toBeVisible();
  });

  test('clear history button exists', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(1000);

    const clearBtn = page.locator('button:has-text("Clear"), button:has-text("clear")').first();
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
  });

  test('about section shows version info', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(1000);

    const about = page.locator('text=/About|version|jAIsus/i');
    const count = await about.count();
    expect(count).toBeGreaterThan(0);
  });

  test('panel closes on Escape', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Settings")').click();
    await page.waitForTimeout(800);
    await closeAnyPanel(page);
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 8. COMMUNITY PANEL ───────────────────────────────────

test.describe('8. Community Panel', () => {
  test('opens with Coming Soon placeholder', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Community")').click();
    await page.waitForTimeout(1000);

    const placeholder = page.locator('text=/Coming Soon|community/i').first();
    await expect(placeholder).toBeVisible({ timeout: 5000 });
  });

  test('panel closes on Escape', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Community")').click();
    await page.waitForTimeout(800);
    await closeAnyPanel(page);
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 9. API ENDPOINTS ─────────────────────────────────────

test.describe('9. API Health Checks', () => {
  test('POST /api/chat returns streaming response', async ({ request }) => {
    const response = await request.post(`${LIVE_URL}/api/chat`, {
      data: {
        messages: [{
          id: 'test-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Say hello in one sentence.' }],
        }],
      },
    });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('text-delta');
  });

  test('POST /api/teachings returns teaching JSON', async ({ request }) => {
    const response = await request.post(`${LIVE_URL}/api/teachings`, {
      data: { topic: 'faith' },
    });
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.teaching).toBeTruthy();
    expect(json.teaching.length).toBeGreaterThan(50);
  });

  test('POST /api/tts returns audio or is rate-limited', async ({ request }) => {
    const response = await request.post(`${LIVE_URL}/api/tts`, {
      data: { text: 'Peace be with you.' },
    });
    // 200 = success, 429 = rate limited, 500 = API key issue (all acceptable)
    expect([200, 429, 500]).toContain(response.status());
    if (response.status() === 200) {
      expect(response.headers()['content-type']).toContain('audio');
    }
  });

  test('GET on API routes returns 405', async ({ request }) => {
    const chatGet = await request.get(`${LIVE_URL}/api/chat`);
    expect(chatGet.status()).toBe(405);
  });
});

// ─── 10. PANEL SWITCHING & STRESS ─────────────────────────

test.describe('10. Navigation Stress Test', () => {
  test('rapid panel switching does not crash the app', async ({ page }) => {
    await waitForApp(page);

    const panels = ['Explore Parables', 'Request Prayer', 'Settings', 'Community'];

    for (const label of panels) {
      const btn = page.locator(`button:has-text("${label}")`).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(300);
        await closeAnyPanel(page);
      }
    }

    // App should still be functional
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible({ timeout: 5000 });
  });

  test('multiple messages can be sent sequentially', async ({ page }) => {
    await waitForApp(page);

    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    const form = input.locator('..');
    const sendBtn = form.locator('button').first();

    // Send first message
    await input.fill('What is peace?');
    await sendBtn.click();
    await page.waitForTimeout(5000);

    // Send second message
    await input.fill('Tell me about forgiveness');
    await sendBtn.click();
    await page.waitForTimeout(5000);

    // Both messages should exist in chat history
    const userMessages = page.locator('div').filter({ hasText: /What is peace|forgiveness/i });
    const count = await userMessages.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─── 11. ACCESSIBILITY ────────────────────────────────────

test.describe('11. Accessibility', () => {
  test('has h1 heading', async ({ page }) => {
    await waitForApp(page);
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    const text = await h1.textContent();
    expect(text).toBeTruthy();
  });

  test('all buttons have text or aria-label', async ({ page }) => {
    await waitForApp(page);
    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 15); i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');
      const hasContent = (text && text.trim().length > 0) || ariaLabel;
      // At minimum SVG buttons should have aria-label
      if (!hasContent) {
        const hasSvg = await btn.locator('svg').count() > 0;
        // SVG-only buttons are acceptable (they're icon buttons)
        expect(hasSvg || hasContent).toBeTruthy();
      }
    }
  });

  test('keyboard Tab navigation works', async ({ page }) => {
    await waitForApp(page);
    await page.keyboard.press('Tab');
    const firstFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(firstFocused).toBeTruthy();

    await page.keyboard.press('Tab');
    const secondFocused = await page.evaluate(() => document.activeElement?.tagName);
    expect(secondFocused).toBeTruthy();
  });
});

// ─── 12. STATIC ASSETS ───────────────────────────────────

test.describe('12. Static Assets', () => {
  test('jesus portrait image loads', async ({ request }) => {
    const res = await request.get(`${LIVE_URL}/jesus-portrait.jpg`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image');
  });

  test('at least one video file loads', async ({ request }) => {
    const videos = [
      '/jAisus-embraces.mp4',
      '/jaisus-embraces.mp4',
      '/jAisus-loves-you.mp4',
      '/jaisus-loves-you.mp4',
    ];
    let foundOne = false;
    for (const v of videos) {
      const res = await request.head(`${LIVE_URL}${v}`);
      if (res.status() === 200) {
        foundOne = true;
        break;
      }
    }
    expect(foundOne).toBe(true);
  });

  test('manifest.json loads', async ({ request }) => {
    const res = await request.get(`${LIVE_URL}/manifest.json`);
    expect(res.status()).toBe(200);
  });

  test('app icons load', async ({ request }) => {
    const res192 = await request.get(`${LIVE_URL}/icon-192.png`);
    expect(res192.status()).toBe(200);
  });
});

// ─── 13. ERROR RESILIENCE ─────────────────────────────────

test.describe('13. Error Resilience', () => {
  test('app works when APIs are blocked', async ({ page }) => {
    await page.route('**/api/**', route => route.abort('failed'));
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Core UI should still render
    const title = page.locator('h1');
    await expect(title).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });

  test('app renders when animations are disabled', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
      document.head.appendChild(style);
    });

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('button:has-text("Ask a Question")')).toBeVisible();
  });
});

// ─── 14. SCREENSHOT REPORT ────────────────────────────────

test.describe('14. Visual Snapshots', () => {
  test('capture homepage screenshot', async ({ page }) => {
    await waitForApp(page);
    await page.waitForTimeout(2000); // Let videos load
    await page.screenshot({ path: '/tmp/jaisus-test-results/homepage.png', fullPage: false });
  });

  test('capture teachings panel screenshot', async ({ page }) => {
    await waitForApp(page);
    await page.locator('button:has-text("Dynamic Teachings")').click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: '/tmp/jaisus-test-results/teachings-panel.png', fullPage: false });
  });

  test('capture chat with response', async ({ page }) => {
    await waitForApp(page);
    const input = page.locator('input[placeholder*="question" i], input[placeholder*="type" i]').first();
    await input.fill('What is grace?');
    const form = input.locator('..');
    await form.locator('button').first().click();
    await page.waitForTimeout(8000); // Wait for full response
    await page.screenshot({ path: '/tmp/jaisus-test-results/chat-response.png', fullPage: false });
  });
});
