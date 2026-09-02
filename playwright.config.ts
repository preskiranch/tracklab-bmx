import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 10101);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const bridgeUrl = process.env.PLAYWRIGHT_BRIDGE_URL ?? 'ws://127.0.0.1:19787';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Connector-backed tests share one bridge URL injected into the app. Running
  // them in parallel lets separate specs contend for that port, which can make
  // otherwise passing release checks fail intermittently. Keep the suite
  // serial everywhere so the release gate exercises a deterministic bridge.
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
      command: `PORT=${port} VITE_WATTBIKE_BRIDGE_URL=${bridgeUrl} npm run cloud`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
