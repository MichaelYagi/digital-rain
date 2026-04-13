import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir:   '.',
    testMatch: ['digital-rain.spec.js'],
    timeout:   12000,
    use: { headless: true },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    ],
    webServer: {
        command:             'python3 -m http.server 3999 --directory ../..',
        url:                 'http://127.0.0.1:3999',
        timeout:             10000,
        reuseExistingServer: true,
    },
});