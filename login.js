// ==========================================
// IMPORT FIREBASE CONFIG
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';

// ==========================================
// 1. CHECK IF USER IS ALREADY LOGGED IN
// ==========================================
// If the user has already logged in before, skip this screen
const savedUser = localStorage.getItem('lobbyLink_user');

if (savedUser) {
    console.log("User already logged in. Redirecting to lobby...");
    window.location.href = 'lobby.html';
}

// ==========================================
// 2. HANDLE LOGIN FORM SUBMISSION
// ==========================================
const loginForm = document.getElementById('loginForm');

loginForm.addEventListener('submit', function(event) {
    event.preventDefault(); // Stop the page from refreshing

    // Get the values from the input fields
    const username = document.getElementById('username').value.trim();
    const uid = document.getElementById('uid').value.trim();
    const rank = document.getElementById('rank').value;

    // Sanity check
    if (!username || !uid || !rank) {
        alert("Please fill in all fields!");
        return;
    }

    // Create a user object to save
    const userData = {
        username: username,
        uid: uid,
        rank: rank,
        game: "Bloodstrike",
        avatarColor: getRandomColor(username), // Generate a color based on their name
        loginTime: new Date().toISOString()
    };

    // Save the user to localStorage
    localStorage.setItem('lobbyLink_user', JSON.stringify(userData));

    console.log("User saved:", userData);

    // Redirect them to the lobby
    window.location.href = 'lobby.html';
});

// ==========================================
// 3. HELPER: GENERATE A COLOR FROM USERNAME
// ==========================================
// This gives each user a consistent colored avatar in the UI
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