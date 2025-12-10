/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

'use strict';
const {devices} = require('@playwright/test');

const {CI} = process.env;
const IS_CI = CI === 'true';

// Set default E2E_EDITOR_MODE if not provided (for IDE test runner)
if (!process.env.E2E_EDITOR_MODE) {
  process.env.E2E_EDITOR_MODE = 'rich-text-with-collab-docnode';
}
if (!process.env.E2E_BROWSER) {
  process.env.E2E_BROWSER = 'chromium';
}

const config = {
  forbidOnly: IS_CI,
  projects: [
    {
      name: 'chromium',
      testDir: './packages/lexical-playground/__tests__/',
      use: {...devices['Desktop Chrome']},
    },
    {
      name: 'firefox',
      testDir: './packages/lexical-playground/__tests__/',
      use: {...devices['Desktop Firefox']},
    },
    {
      name: 'webkit',
      testDir: './packages/lexical-playground/__tests__/',
      use: {...devices['Desktop Safari']},
    },
  ],
  retries: IS_CI ? 4 : 1,
  testIgnore: /\/__tests__\/unit\//,
  timeout: 150000,
  use: {
    navigationTimeout: 30000,
    // this causes issues in the CI on on current version.
    //trace: 'retain-on-failure',
    video: 'on-first-retry',
  },
  webServer: IS_CI
    ? {
        command: 'npm run start-test-server',
        port: 4000,
        reuseExistingServer: true,
        timeout: 120 * 1000,
      }
    : {
        // For local development with IDE test runner
        command: 'npm run dev',
        port: 3000,
        reuseExistingServer: true, // Don't fail if already running
        timeout: 120 * 1000,
      },
  workers: 4,
};
module.exports = config;
