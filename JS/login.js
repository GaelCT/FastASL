function handleCredentialsLogin() {
    const userField = document.getElementById('auth-username').value.trim();
    if (!userField) {
        alert('Please fill out authentication fields.');
        return;
    }

    // --- USERNAME VALIDATION: 3 to 8 alphanumeric/underscore characters ---
    const usernameRegex = /^[a-zA-Z0-9_]{3,8}$/;
    if (!usernameRegex.test(userField)) {
        alert('Username must be between 3 and 8 characters (letters, numbers, underscores only).');
        return;
    }

    executeUserSessionEstablishment(userField.toUpperCase());
}

function executeUserSessionEstablishment(username) {
    const userSession = {
        username: username,
        token: "jwt_frontend_mock_token_sequence"
    };

    // Store state in local memory context across multi-page boundaries
    localStorage.setItem('aslRacerUser', JSON.stringify(userSession));
    
    // Route execution context directly over to dashboard canvas
    window.location.href = 'dashboard.html';
}

// Ensure session cleanup if hitting login page directly
localStorage.removeItem('aslRacerUser');