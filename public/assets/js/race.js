const state = {
    user: null,
    sentence: '',
    currentIndex: 0,
    score: 0, 
    streak: 0,
    maxStreak: 0,
    timeLeft: 60,
    isPlaying: false,
    totalAttempts: 0,
    correctAttempts: 0,
    camera: null,
    hands: null,
    gameDuration: 60
};

const SENTENCES = [
    "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG",
    "SOFTWARE ENGINEERING REQUIRES PATIENCE AND LOGIC",
    "COMPUTER VISION ENGINE IS TRACKING HAND LANDMARKS",
    "FINGERSPELLING PRACTICE SPEEDS UP MUSCLE MEMORY",
    "KEEP YOUR COMBO MULTIPLIER ALIVE TO WIN"
];

const els = {
    sentenceDisplay: document.getElementById('sentence-display'),
    timer: document.getElementById('timer'),
    wpm: document.getElementById('wpm'),
    streak: document.getElementById('streak'),
    video: document.getElementById('webcam'),
    canvas: document.getElementById('output-canvas'),
    trackingStatus: document.getElementById('tracking-status'),
    finalWpm: document.getElementById('final-wpm'),
    finalStreak: document.getElementById('final-streak'),
    finalAccuracy: document.getElementById('final-accuracy'),
    playerName: document.getElementById('player-name'),
    gameScreen: document.getElementById('game-screen'),
    endScreen: document.getElementById('end-screen')
};

let timerInterval = null;

function verifyAuthAndInitialize() {
    const sessionData = localStorage.getItem('aslRacerUser');
    if (!sessionData) {
        window.location.href = 'login.html';
        return;
    }
    state.user = JSON.parse(sessionData);
    els.playerName.value = state.user.username;

    const duration = localStorage.getItem('aslTargetDuration');
    state.gameDuration = duration ? parseInt(duration, 10) : 60;
    
    initMediaPipe();
    startGame();
}

function initMediaPipe() {
    if (typeof Hands === 'undefined') {
        setTimeout(initMediaPipe, 500);
        return;
    }

    state.hands = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`});
    state.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    state.hands.onResults(handleMediaPipeResults);

    if (typeof Camera !== 'undefined') {
        state.camera = new Camera(els.video, {
            onFrame: async () => { if (state.hands && state.isPlaying) await state.hands.send({image: els.video}); },
            width: 640, height: 480
        });
    }
}

function handleMediaPipeResults(results) {
    const context = els.canvas.getContext('2d');
    context.save();
    context.clearRect(0, 0, els.canvas.width, els.canvas.height);
    context.drawImage(results.image, 0, 0, els.canvas.width, els.canvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        els.trackingStatus.textContent = 'TRACKING ACTIVE';
        els.trackingStatus.classList.add('active');
        for (const landmarks of results.multiHandLandmarks) {
            if (typeof drawConnectors === 'function' && window.HAND_CONNECTIONS) {
                drawConnectors(context, landmarks, HAND_CONNECTIONS, { color: '#ffd100', lineWidth: 3 });
            }
            if (typeof drawLandmarks === 'function') {
                drawLandmarks(context, landmarks, { color: '#ffffff', lineWidth: 1.5, radius: 3 });
            }
        }
    } else {
        els.trackingStatus.textContent = 'SEARCHING FOR HAND MATRIX...';
        els.trackingStatus.classList.remove('active');
    }
    context.restore();
}

function startGame() {
    state.score = 0;
    state.streak = 0;
    state.maxStreak = 0;
    state.timeLeft = state.gameDuration;
    state.isPlaying = true;
    state.totalAttempts = 0;
    state.correctAttempts = 0;

    els.gameScreen.classList.add('active');
    els.endScreen.classList.remove('active');
    els.canvas.width = 640; els.canvas.height = 480;

    syncStatsPanel();
    loadNewRacerSentence();

    if (state.camera) {
        state.camera.start().catch(() => {
            els.trackingStatus.textContent = 'CAMERA DISCONNECTED';
            els.trackingStatus.classList.add('active');
        });
    }

    timerInterval = setInterval(() => {
        state.timeLeft--;
        els.timer.textContent = state.timeLeft;
        els.timer.classList.toggle('danger', state.timeLeft <= 10);
        syncStatsPanel();
        if (state.timeLeft <= 0) terminateGameInstance();
    }, 1000);
}

function loadNewRacerSentence() {
    state.sentence = SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
    state.currentIndex = 0;
    buildSentenceDOM();
}

function buildSentenceDOM() {
    els.sentenceDisplay.innerHTML = '';
    const wordBlocks = state.sentence.split(' ');
    let structuralIndex = 0;

    wordBlocks.forEach((wordText, blockIndex) => {
        const wordContainer = document.createElement('div');
        wordContainer.className = 'word';

        for (let i = 0; i < wordText.length; i++) {
            const characterSpan = document.createElement('span');
            characterSpan.textContent = wordText[i];
            characterSpan.className = 'letter';
            characterSpan.id = `char-${structuralIndex}`;
            wordContainer.appendChild(characterSpan);
            structuralIndex++;
        }
        els.sentenceDisplay.appendChild(wordContainer);

        if (blockIndex < wordBlocks.length - 1) {
            const trackingSpace = document.createElement('span');
            trackingSpace.textContent = ' ';
            trackingSpace.className = 'letter space';
            trackingSpace.id = `char-${structuralIndex}`;
            els.sentenceDisplay.appendChild(trackingSpace);
            structuralIndex++;
        }
    });
    evaluateCursorPlacement();
}

function evaluateCursorPlacement() {
    document.querySelectorAll('.letter').forEach(span => span.classList.remove('current'));
    const targetedTarget = document.getElementById(`char-${state.currentIndex}`);
    if (targetedTarget) targetedTarget.classList.add('current');
}

function checkSign(input) {
    if (!state.isPlaying) return;
    const targetedTarget = document.getElementById(`char-${state.currentIndex}`);
    const expectedMatch = state.sentence[state.currentIndex];
    state.totalAttempts++;

    if (input.toUpperCase() === expectedMatch) {
        if (targetedTarget) targetedTarget.className = 'letter correct';
        state.streak++;
        if (state.streak > state.maxStreak) state.maxStreak = state.streak;
        state.correctAttempts++;
        state.currentIndex++;

        while (state.currentIndex < state.sentence.length && state.sentence[state.currentIndex] === ' ') {
            const nestedSpace = document.getElementById(`char-${state.currentIndex}`);
            if (nestedSpace) nestedSpace.className = 'letter correct';
            state.currentIndex++;
            state.correctAttempts++; 
        }

        if (state.currentIndex >= state.sentence.length) {
            triggerExplosiveFeedback(targetedTarget);
            setTimeout(loadNewRacerSentence, 250);
        } else {
            evaluateCursorPlacement();
        }
    } else {
        state.streak = 0; 
        if (targetedTarget) {
            targetedTarget.classList.add('wrong');
            setTimeout(() => targetedTarget.classList.remove('wrong'), 250);
        }
    }
    syncStatsPanel();
}

function syncStatsPanel() {
    const runtimeSpan = (state.gameDuration - state.timeLeft) / 60;
    const computedWPM = runtimeSpan > 0 ? Math.round((state.correctAttempts / 5) / runtimeSpan) : 0;
    state.score = computedWPM; 
    els.wpm.textContent = computedWPM;
    els.streak.textContent = state.streak;
}

function terminateGameInstance() {
    state.isPlaying = false;
    clearInterval(timerInterval);
    if (state.camera) { try { state.camera.stop(); } catch (e) { /* camera already stopped */ } }

    const computedAccuracy = state.totalAttempts > 0 ? Math.round((state.correctAttempts / state.totalAttempts) * 100) : 0;
    els.finalWpm.textContent = `${state.score} WPM`;
    els.finalStreak.textContent = state.maxStreak;
    els.finalAccuracy.textContent = `${computedAccuracy}%`;

    els.gameScreen.classList.remove('active');
    els.endScreen.classList.add('active');
}

function saveAndShowLeaderboard() {
    const clientName = els.playerName.value.trim() || state.user.username || 'RACER';
    const databaseRecord = { name: clientName.toUpperCase(), score: state.score, date: new Date().toLocaleDateString() };
    
    const rawData = localStorage.getItem('aslRacerDualData');
    const currentBoards = rawData ? JSON.parse(rawData) : { global: [], regional: [] };
    
    currentBoards.global.push(databaseRecord);
    currentBoards.global.sort((x, y) => y.score - x.score);
    currentBoards.global.splice(10);

    localStorage.setItem('aslRacerDualData', JSON.stringify(currentBoards));
    navigateToDashboard();
}

function restartGame() {
    startGame();
}

function navigateToDashboard() {
    if (state.camera) { try { state.camera.stop(); } catch (e) { /* camera already stopped */ } }
    window.location.href = 'dashboard.html';
}

document.addEventListener('keydown', (event) => {
    if (!state.isPlaying) return;
    if (event.key.length === 1 && /[a-zA-Z]/.test(event.key)) checkSign(event.key);
});

function triggerExplosiveFeedback(targetNode) {
    if (!targetNode) return;
    const boundary = targetNode.getBoundingClientRect();
    for (let idx = 0; idx < 12; idx++) {
        const component = document.createElement('div');
        component.className = 'particle';
        component.style.background = ['#ffd100', '#00e676', '#ffffff'][Math.floor(Math.random() * 3)];
        component.style.left = `${boundary.left + boundary.width / 2}px`;
        component.style.top = `${boundary.top + boundary.height / 2}px`;
        component.style.position = 'fixed';
        component.style.zIndex = '1000';
        const polarTrajectory = (Math.PI * 2 * idx) / 12;
        component.style.setProperty('--tx', Math.cos(polarTrajectory) * 80 + 'px');
        component.style.setProperty('--ty', Math.sin(polarTrajectory) * 80 + 'px');
        document.body.appendChild(component);
        setTimeout(() => component.remove(), 450);
    }
}

document.addEventListener('DOMContentLoaded', verifyAuthAndInitialize);

document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('save-score-button');
    const dashboardButton = document.getElementById('navigate-dashboard-button');
    const restartButton = document.getElementById('restart-game-button');

    if (saveButton) {
        saveButton.addEventListener('click', saveAndShowLeaderboard);
    }
    if (dashboardButton) {
        dashboardButton.addEventListener('click', navigateToDashboard);
    }
    if (restartButton) {
        restartButton.addEventListener('click', restartGame);
    }
});