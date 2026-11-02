import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/web',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 844 } },
  webServer: { command: 'npm run build && npm run preview -w @smartbord/mobile', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
});
