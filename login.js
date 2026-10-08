// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';

// ==========================================
// AUTO-LOGIN CHECK
// ==========================================
const savedUser = localStorage.getItem('lobbyLink_user');
if (savedUser) {
    window.location.href = 'lobby.html';
}

// ==========================================
// UI
// ==========================================
const loginForm = document.getElementById('loginForm');
const uidInput  = document.getElementById('uid');
const uidError  = document.getElementById('uidError');

// Strip non-numbers as the user types
uidInput.addEventListener('input', () => {
    uidInput.value = uidInput.value.replace(/\D/g, '').slice(0, 12);
    uidError.textContent = '';
});

// ==========================================
// SUBMIT
// ==========================================
loginForm.addEventListener('submit', function (event) {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const uid      = uidInput.value.trim();
    const rank     = document.getElementById('rank').value;

    if (!username || !rank) {
        alert("Please fill in all fields!");
        return;
    }

    // Validate UID
    if (uid.length !== 12 || !/^\d{12}$/.test(uid)) {
        uidError.textContent = `UID must be exactly 12 digits (you entered ${uid.length}).`;
        uidInput.focus();
        return;
    }

    const userData = {
        username: username,
        uid: uid,
        rank: rank,
        game: "Bloodstrike",
        avatarColor: getRandomColor(username),
        loginTime: new Date().toISOString()
    };

    localStorage.setItem('lobbyLink_user', JSON.stringify(userData));
    window.location.href = 'lobby.html';
});

// ==========================================
// HASH USERNAME → COLOR
// ==========================================
function getRandomColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
        '#ff4d4d', '#ff8c42', '#ffd93d', '#6bcb77',
        '#4d96ff', '#9b5de5', '#f15bb5', '#00bbf9'
    ];
    return colors[Math.abs(hash) % colors.length];
            }
