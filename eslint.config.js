const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                localStorage: 'readonly',
                navigator: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                console: 'readonly',
                alert: 'readonly',
                fetch: 'readonly',
                JSON: 'readonly',
                Math: 'readonly',
                RegExp: 'readonly',
                parseInt: 'readonly',
                parseFloat: 'readonly',
                location: 'readonly',
                Map: 'readonly',
                Set: 'readonly',
                Promise: 'readonly',
                Image: 'readonly',
                HTMLVideoElement: 'readonly',
                HTMLCanvasElement: 'readonly',
                MediaPipe: 'readonly',
                Hands: 'readonly',
                Camera: 'readonly',
                drawConnectors: 'readonly',
                drawLandmarks: 'readonly',
                HAND_CONNECTIONS: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': 'off',
            'no-undef': 'error',
        },
    },
    {
        ignores: [
            '**/node_modules/**',
            '**/vendor/**',
            '**/*.min.js',
        ],
    },
];
