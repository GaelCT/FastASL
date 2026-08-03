import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const expectedScripts = new Map([
    ['https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js', 'sha256-7hTNJB9pNQSp6lX6Ly7Tsk2h98+ASSZxYGnQ0jJDTY4='],
    ['https://cdn.jsdelivr.net/npm/@mediapipe/control_utils@0.6.1675466023/control_utils.js', 'sha256-PQUiN08rKZsmeD1JMlv9qbxkVoBN5I6Tkt6/PFRQAY0='],
    ['https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js', 'sha256-jSEoZg3kWHX8jLP/IA1kMvyL9VZoKuccFzviT0LqnqM='],
    ['https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js', 'sha256-poshyVU9YUOE9/RZYi5G4C48nP33OSkVovodYV4zhHM=']
]);
const sriPattern = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function attribute(tag, name) {
    return new RegExp(`\\b${name}=["']([^"']+)["']`, 'i').exec(tag)?.[1];
}

async function assertNoInlineHandlers() {
    const files = (await readdir('public')).filter((file) => file.endsWith('.html'));
    const handlerPattern = /\son(?:click|change|submit|load|input|keydown|keyup|mouseover|mouseout)\s*=/i;
    for (const file of files) {
        if (handlerPattern.test(await readFile(join('public', file), 'utf8'))) {
            throw new Error(`${file} contains an inline JavaScript event handler`);
        }
    }
}

async function verify() {
    await assertNoInlineHandlers();
    const html = await readFile('public/race.html', 'utf8');
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc=[^>]*><\/script>/gi)].map((match) => match[0]);
    const external = tags.filter((tag) => attribute(tag, 'src')?.startsWith('https://'));
    if (external.length !== expectedScripts.size) {
        throw new Error(`Expected ${expectedScripts.size} external MediaPipe scripts, found ${external.length}`);
    }

    for (const tag of external) {
        const src = attribute(tag, 'src');
        const integrity = attribute(tag, 'integrity');
        const crossorigin = attribute(tag, 'crossorigin');
        if (!expectedScripts.has(src)) {
            throw new Error(`Unexpected or unversioned external script: ${src}`);
        }
        if (!sriPattern.test(integrity ?? '')) {
            throw new Error(`Invalid SRI syntax for ${src}: ${integrity}`);
        }
        const [algorithm, declaredDigest] = integrity.split('-', 2);
        if (algorithm === 'sha256' && Buffer.from(declaredDigest, 'base64').length !== 32) {
            throw new Error(`sha256 integrity digest is not 32 bytes for ${src}`);
        }
        if (crossorigin !== 'anonymous') {
            throw new Error(`crossorigin must be anonymous for ${src}`);
        }
        const response = await fetch(src);
        if (!response.ok) {
            throw new Error(`Could not download ${src}: HTTP ${response.status}`);
        }
        const computed = `${algorithm}-${createHash(algorithm).update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
        if (integrity !== computed || integrity !== expectedScripts.get(src)) {
            throw new Error(`SRI mismatch for ${src}: declared ${integrity}, computed ${computed}`);
        }
        console.log(`Verified ${src}: ${computed}`);
    }
}

await verify();
