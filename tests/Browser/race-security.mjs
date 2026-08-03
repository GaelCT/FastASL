import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:8080';
const testOrigin = new URL(baseUrl).origin;
const handsBaseUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
const requiredHandsRuntimeFiles = [
    'hands_solution_packed_assets_loader.js',
    'hands_solution_simd_wasm_bin.js'
];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const handsRequests = [];
const handsResponses = new Map();

const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
});
const context = await browser.newContext();
await context.grantPermissions(['camera'], { origin: testOrigin });
await context.addInitScript(() => {
    localStorage.setItem('aslRacerUser', JSON.stringify({ username: 'TESTER', token: 'browser-test' }));
    window.__cameraSecurityTest = { calls: [], liveVideoTrackObserved: false };

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
        return;
    }

    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (constraints) => {
        window.__cameraSecurityTest.calls.push(constraints);
        const stream = await originalGetUserMedia(constraints);
        window.__cameraSecurityTest.liveVideoTrackObserved = stream
            .getVideoTracks()
            .some((track) => track.readyState === 'live');
        return stream;
    };
});
const page = await context.newPage();

page.on('console', (message) => {
    if (message.type() === 'error') {
        consoleErrors.push(message.text());
    }
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('request', (request) => {
    if (request.url().includes('/@mediapipe/hands')) {
        handsRequests.push(request.url());
    }
});
page.on('response', (response) => {
    if (response.url().includes('cdn.jsdelivr.net') && response.status() >= 400) {
        badResponses.push(`${response.status()} ${response.url()}`);
    }
    if (response.url().includes('/@mediapipe/hands')) {
        handsResponses.set(response.url(), response.status());
    }
});

const runtimeResponseWaiters = requiredHandsRuntimeFiles.map((filename) => page.waitForResponse(
    (response) => response.url() === `${handsBaseUrl}${filename}`,
    { timeout: 15_000 }
));

try {
    const response = await page.goto(`${baseUrl}/race.html`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, 'race page must load successfully');
    await page.waitForFunction(
        () => {
            const cameraTest = window.__cameraSecurityTest;
            const video = document.getElementById('webcam');
            const stream = video?.srcObject;
            return cameraTest?.calls.length > 0
                && cameraTest.liveVideoTrackObserved
                && stream instanceof MediaStream
                && stream.getVideoTracks().some((track) => track.readyState === 'live');
        },
        undefined,
        { timeout: 15_000 }
    );
    await page.waitForFunction(
        () => Boolean(window.Camera && window.Hands && window.drawConnectors),
        undefined,
        { timeout: 15_000 }
    );
    const runtimeResponses = await Promise.all(runtimeResponseWaiters);

    await page.locator('#restart-game-button').evaluate((button) => {
        button.click();
    });
    await page.waitForFunction(
        () => document.getElementById('game-screen')?.classList.contains('active'),
        undefined,
        { timeout: 5_000 }
    );
    assert.equal(
        await page.locator('#game-screen').evaluate((element) => element.classList.contains('active')),
        true,
        'the external restart-button listener must activate the game screen'
    );

    const cameraState = await page.evaluate(() => {
        const video = document.getElementById('webcam');
        const stream = video?.srcObject;
        return {
            calls: window.__cameraSecurityTest.calls,
            liveVideoTrackObserved: window.__cameraSecurityTest.liveVideoTrackObserved,
            videoHasMediaStream: stream instanceof MediaStream,
            liveVideoTracks: stream instanceof MediaStream
                ? stream.getVideoTracks().filter((track) => track.readyState === 'live').length
                : 0
        };
    });
    assert.ok(cameraState.calls.length > 0, 'getUserMedia must be called at least once');
    assert.ok(cameraState.calls.some((constraints) => constraints?.video), 'getUserMedia must request video');
    assert.equal(cameraState.liveVideoTrackObserved, true, 'getUserMedia must return a live video track');
    assert.equal(cameraState.videoHasMediaStream, true, 'the webcam element must have a MediaStream srcObject');
    assert.ok(cameraState.liveVideoTracks > 0, 'a webcam video track must still be live');

    assert.equal(
        await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === '/assets/js/race.js')),
        true,
        'race.js must load'
    );
    assert.ok(handsRequests.length > 0, 'Hands runtime requests must be observed');
    for (const requestUrl of handsRequests) {
        assert.ok(requestUrl.startsWith(handsBaseUrl), `Hands request must use the exact pinned base: ${requestUrl}`);
        assert.ok(handsResponses.has(requestUrl), `Hands request must complete: ${requestUrl}`);
        const status = handsResponses.get(requestUrl);
        assert.ok(status >= 200 && status < 300, `Hands response must be 2xx: ${status} ${requestUrl}`);
    }
    for (const [filename, runtimeResponse] of requiredHandsRuntimeFiles.map((filename, index) => [filename, runtimeResponses[index]])) {
        const expectedUrl = `${handsBaseUrl}${filename}`;
        assert.ok(handsRequests.includes(expectedUrl), `Hands runtime request missing: ${expectedUrl}`);
        assert.equal(runtimeResponse.url(), expectedUrl, `Hands runtime response URL mismatch for ${filename}`);
        assert.ok(runtimeResponse.status() >= 200 && runtimeResponse.status() < 300, `Hands runtime response must be 2xx: ${runtimeResponse.status()} ${expectedUrl}`);
    }

    assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('\n')}`);
    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(failedRequests, [], `Failed network requests: ${failedRequests.join('\n')}`);
    assert.deepEqual(badResponses, [], `Failed CDN responses: ${badResponses.join('\n')}`);
} finally {
    await browser.close();
}

console.log('Race browser security regression passed');
