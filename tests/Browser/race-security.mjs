import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:8080';
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ permissions: ['camera'] });
await context.addInitScript(() => localStorage.setItem('aslRacerUser', JSON.stringify({ username: 'TESTER', token: 'browser-test' })));
const page = await context.newPage();

page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('response', (response) => {
    if (response.url().includes('cdn.jsdelivr.net') && response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
});

try {
    const response = await page.goto(`${baseUrl}/race.html`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, 'race page must load successfully');
    await page.waitForFunction(() => Boolean(window.Camera && window.Hands && window.drawConnectors));
    assert.equal(await page.locator('#restart-game-button').evaluate((button) => { button.click(); return document.getElementById('game-screen').classList.contains('active'); }), true);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === '/assets/js/race.js')), true, 'race.js must load');

    const relevantConsoleErrors = consoleErrors.filter((entry) => /content security policy|integrity|refused|blocked/i.test(entry));
    assert.deepEqual(relevantConsoleErrors, [], `CSP or SRI console failures: ${relevantConsoleErrors.join('\n')}`);
    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(failedRequests, [], `Failed network requests: ${failedRequests.join('\n')}`);
    assert.deepEqual(badResponses, [], `Failed MediaPipe responses: ${badResponses.join('\n')}`);
} finally {
    await browser.close();
}

console.log('Race browser security regression passed');
