import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Attached mode drives one shared PHP-FPM; a single retry absorbs load transients.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
});
