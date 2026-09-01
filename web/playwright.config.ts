import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    fullyParallel: true,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: "http://localhost:3000",
        // These tests mock every /api/** call themselves (see tests/mockApi.ts) —
        // never rely on a real backend, so nothing in a test run ever touches
        // the real production Railway backend that next.config.ts rewrites to.
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
