const state = {
    user: null,
    leaderboardScope: 'global'
};

const els = {
    sessionBadge: document.getElementById('session-badge'),
    leaderboardList: document.getElementById('leaderboard-list')
};

function authenticateSessionRoute() {
    const sessionData = localStorage.getItem('aslRacerUser');
    if (!sessionData) {
        window.location.href = 'login.html';
        return;
    }
    state.user = JSON.parse(sessionData);
    els.sessionBadge.textContent = `CONNECTED: ${state.user.username}`;
}

function selectRaceConfiguration(duration) {
    localStorage.setItem('aslTargetDuration', duration);
    window.location.href = 'race.html';
}

function switchLeaderboardScope(scope) {
    state.leaderboardScope = scope;
    
    document.getElementById('tab-global').classList.toggle('active', scope === 'global');
    document.getElementById('tab-regional').classList.toggle('active', scope === 'regional');
    
    renderLeaderboard();
}

function getLocalLeaderboards() {
    const rawData = localStorage.getItem('aslRacerDualData');
    return rawData ? JSON.parse(rawData) : { global: [], regional: [] };
}

function renderLeaderboard() {
    const currentBoards = getLocalLeaderboards();
    const targetedActiveArray = currentBoards[state.leaderboardScope] || [];

    if (targetedActiveArray.length === 0) {
        els.leaderboardList.innerHTML = `<div class="empty-board">NO RACES RECORDED IN THIS ${state.leaderboardScope.toUpperCase()} STREAM</div>`;
        return;
    }
    
    els.leaderboardList.innerHTML = targetedActiveArray.map((record, index) => `
        <div class="leaderboard-entry ${index < 3 ? 'top-' + index : ''}">
            <span class="rank">${index + 1}</span>
            <span class="name">${record.name}</span>
            <span class="score">${record.score} WPM</span>
        </div>
    `).join('');
}

// Lifecycle Boot loops
document.addEventListener('DOMContentLoaded', () => {
    authenticateSessionRoute();
    renderLeaderboard();
});