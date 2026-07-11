import { defineConfig } from '@playwright/test';

/**
 * Shared runner config for all shakedown passes.
 *
 * `ignoreHTTPSErrors` accommodates self-signed local TLS (.test domains);
 * traces are kept on failure so any red route can be replayed step-by-step.
 */
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
