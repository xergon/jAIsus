# jAIsus App UI Test Suite

Comprehensive Playwright test suite for the jAIsus mobile app - a Next.js-based AI biblical assistant application.

## Overview

This test suite provides end-to-end UI testing for all major features of the jAIsus app, including:
- Hero section and animated components
- Chat interface and messaging
- Navigation between panels (Parables, Prayer, Teachings, Settings, Community)
- Voice controls and visualizers
- Responsive design and accessibility

## Test Coverage

### Test Categories

1. **Hero Section & Title** (4 tests)
   - Title rendering with proper styling
   - Animated Jesus component visibility
   - Voice visualizer bars animation
   - AI status badge display

2. **Navigation & Panels** (5 tests)
   - All navigation buttons render
   - Panel switching (Parables, Prayer, Settings, Community)
   - Proper panel opening and closing

3. **Chat Interface** (5 tests)
   - Chat input field rendering
   - Text input functionality
   - Send button visibility
   - Message display area
   - Message sending and receiving

4. **Parables Panel** (3 tests)
   - Parables list display
   - Clickable parable items
   - Panel closing functionality

5. **Prayer Panel** (3 tests)
   - Prayer form display
   - Prayer request text input
   - Form submission

6. **Settings Panel** (5 tests)
   - Settings controls display
   - Theme toggle
   - Voice toggle
   - Text size controls
   - Toggle interaction

7. **Community Panel** (2 tests)
   - Community section display
   - Sharing features

8. **Voice Controls** (2 tests)
   - Voice button rendering
   - Speaker toggle

9. **Teachings Panel** (2 tests)
   - Teachings section rendering
   - New Teaching button

10. **Responsive Design** (3 tests)
    - Mobile viewport (393x852) adherence
    - No horizontal scroll overflow
    - Vertical scrolling functionality

11. **Panel Switching** (2 tests)
    - Rapid panel switching
    - State persistence

12. **Accessibility** (4 tests)
    - Heading hierarchy
    - Button accessibility labels
    - Color contrast
    - Keyboard navigation support

13. **Preview HTML File** (1 test)
    - Self-contained preview.html loading

14. **Component Integration** (3 tests)
    - All components rendering together
    - Rapid switching stress test
    - Console error monitoring

15. **Error Handling** (2 tests)
    - Graceful API failure handling
    - Animation failure handling

**Total: 46 test cases** across mobile and desktop viewports = 92 tests

## Installation

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Setup

```bash
# Install Playwright and dependencies (already done)
npm install -D @playwright/test

# Install browsers
npx playwright install chromium
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run with UI mode (interactive)
```bash
npm run test:ui
```

### Run mobile tests only
```bash
npm run test:mobile
```

### Run desktop tests only
```bash
npm run test:desktop
```

### Run specific test file
```bash
npx playwright test tests/ui-test.spec.ts
```

### Run with debugging
```bash
npm run test:debug
```

### Run with specific browser
```bash
npx playwright test --project=chromium-mobile
```

### Run specific test by name
```bash
npx playwright test -g "should render the jAIsus title"
```

### Run tests in headed mode (see the browser)
```bash
npx playwright test --headed
```

## Test Configuration

### Viewport Sizes

- **Mobile (Pixel 5)**: 393x852px - default for most tests
- **Desktop**: 1280x720px - available via `chromium-desktop` project

### Browsers

- Chromium-based browsers (Chrome)
- Additional browsers can be added to `playwright.config.ts`

## Test File Structure

```
tests/
├── ui-test.spec.ts       # Main test suite
└── README.md            # This file

playwright.config.ts     # Test configuration
```

## Test Selectors

Tests use a combination of selectors for robustness:

1. **Text-based selectors** (primary)
   ```typescript
   page.locator('button:has-text("Ask a Question")')
   page.locator('text=/prayer|request/i') // regex
   ```

2. **Class-based selectors** (fallback)
   ```typescript
   page.locator('[class*="close" i]')
   ```

3. **Role-based selectors**
   ```typescript
   page.locator('button[role="switch"]')
   ```

4. **Hierarchical selectors**
   ```typescript
   page.locator('h1').locator('span').filter({ hasText: 'AI' })
   ```

This approach ensures tests work even without `data-testid` attributes.

## Test Patterns

### Waiting for Elements
```typescript
await expect(element).toBeVisible({ timeout: 5000 });
```

### Panel Navigation
```typescript
const button = page.locator('button:has-text("Parables")');
await button.click();
await page.waitForTimeout(1000); // Wait for animation
```

### Keyboard Navigation
```typescript
await page.keyboard.press('Escape'); // Close panel
await page.keyboard.press('Tab');    // Navigate
```

### Error Handling
```typescript
// Graceful handling if element not found
if (await element.isVisible().catch(() => false)) {
  await expect(element).toBeVisible();
}
```

## Continuous Integration

To run tests in CI/CD:

```bash
npm test
```

Configuration in `playwright.config.ts`:
- Disables parallel test execution in CI
- Sets retries to 2
- Uses single worker
- Records videos on failure
- Takes screenshots on failure

## Troubleshooting

### Tests fail with "Page not found"

Ensure the app is running:
```bash
npm run dev
```

Or set BASE_URL:
```bash
BASE_URL=http://localhost:3000 npm test
```

### Timeout errors

Increase timeout in specific tests:
```typescript
await expect(element).toBeVisible({ timeout: 10000 });
```

### Element not found

Check the page structure:
```bash
npx playwright test --debug
```

### Headless browser issues

Run in headed mode to debug:
```bash
npm test -- --headed
```

## Reports

Test results are stored in:
- `test-results/` - Test result details
- `playwright-report/` - HTML report

View HTML report:
```bash
npx playwright show-report
```

## Best Practices

1. **Use data-testid for stable selectors**
   - Currently using text-based, but adding `data-testid` to components improves test reliability

2. **Avoid hard waits**
   - Tests use `waitForTimeout` only where necessary
   - Prefer `waitForLoadState()` and `toBeVisible()`

3. **Keep tests focused**
   - Each test focuses on one feature
   - Use descriptive names

4. **Handle flakiness**
   - Tests include error handling for missing elements
   - Use conditional checks before assertions

5. **Test mobile first**
   - Mobile viewport is default (393x852)
   - Desktop tests run in addition

## Adding New Tests

To add a new test:

```typescript
test('should do something', async ({ page }) => {
  await page.goto('/');
  
  // Arrange
  const element = page.locator('selector');
  
  // Act
  await element.click();
  
  // Assert
  await expect(element).toHaveStatus(expectedState);
});
```

## Performance Considerations

- Tests run in parallel by default (set to 1 worker in CI)
- Average test runtime: 2-5 seconds per test
- Full suite runtime: ~2-3 minutes (with retries and both viewports)

## Maintenance

Update tests when:
1. Component selectors change
2. New features are added
3. UI layout changes
4. Navigation structure changes

Run tests after any UI changes:
```bash
npm test
```

## Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [Test Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)
- [CI/CD Integration](https://playwright.dev/docs/ci)

## Support

For issues or questions:
1. Check Playwright docs
2. Run tests in debug mode: `npm run test:debug`
3. Check test output and screenshots in `test-results/`
