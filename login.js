// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, ref, get, set
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// AUTO-LOGIN CHECK (with staleness guard)
// ==========================================
const savedUserRaw = localStorage.getItem('lobbyLink_user');
if (savedUserRaw) {
    try {
        const savedUser = JSON.parse(savedUserRaw);
        const loginTime = new Date(savedUser.loginTime).getTime();
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        // If logged in within the last 24 hours, skip login
        if (now - loginTime < ONE_DAY) {
            window.location.href = 'lobby.html';
        } else {
            // Stale — clear it and show login
            localStorage.removeItem('lobbyLink_user');
            localStorage.removeItem('lobbyLink_currentRoom');
        }
    } catch (e) {
        // Corrupted data — clear it
        localStorage.removeItem('lobbyLink_user');
        localStorage.removeItem('lobbyLink_currentRoom');
    }
}

// ==========================================
// UI
// ==========================================
const loginForm = document.getElementById('loginForm');
const uidInput  = document.getElementById('uid');
const uidError  = document.getElementById('uidError');
const enterBtn  = document.getElementById('enterBtn');

uidInput.addEventListener('input', () => {
    uidInput.value = uidInput.value.replace(/\D/g, '').slice(0, 12);
    uidError.textContent = '';
});

// ==========================================
// SUBMIT
// ==========================================
loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const username = document.getElementById('username').value.trim();
    const uid      = uidInput.value.trim();
    const rank     = document.getElementById('rank').value;

    if (!username || !rank) {
        alert("Please fill in all fields!");
        return;
    }

    if (uid.length !== 12 || !/^\d{12}$/.test(uid)) {
        uidError.textContent = `UID must be exactly 12 digits (you entered ${uid.length}).`;
        uidInput.focus();
        return;
    }

    if (username.length < 3) {
        alert("Username must be at least 3 characters.");
        return;
    }

    enterBtn.disabled = true;
    enterBtn.textContent = 'CHECKING...';

    try {
        // ==========================================
        // CHECK FOR DUPLICATE USERNAME
        // ==========================================
        const usernameSnap = await get(ref(db, 'registered_users/' + username.toLowerCase()));
        if (usernameSnap.exists()) {
            alert(`The username "${username}" is already taken. Pick another one.`);
            enterBtn.disabled = false;
            enterBtn.textContent = 'ENTER THE LOBBY';
            return;
        }

        // ==========================================
        // CHECK FOR DUPLICATE UID
        // ==========================================
        // We scan all registered users to see if this UID is claimed.
        const allUsersSnap = await get(ref(db, 'registered_users'));
        let uidTaken = false;
        let takenBy = '';

        if (allUsersSnap.exists()) {
            allUsersSnap.forEach((child) => {
                const u = child.val();
                if (u && u.uid === uid && u.username.toLowerCase() !== username.toLowerCase()) {
                    uidTaken = true;
                    takenBy = u.username;
                }
            });
        }

        if (uidTaken) {
            uidError.textContent = `This UID is already registered to "${takenBy}".`;
            alert(`This Bloodstrike UID is already in use by "${takenBy}". Each UID can only belong to one LobbyLink account.`);
            enterBtn.disabled = false;
            enterBtn.textContent = 'ENTER THE LOBBY';
            return;
        }

        // ==========================================
        // REGISTER THE USER
        // ==========================================
        const userData = {
            username: username,
            uid: uid,
            rank: rank,
            game: "Bloodstrike",
            avatarColor: getRandomColor(username),
            loginTime: new Date().toISOString()
        };

        // Save to Firebase (so we can check duplicates later)
        await set(ref(db, 'registered_users/' + username.toLowerCase()), {
            username: username,
            uid: uid,
            rank: rank,
            registeredAt: Date.now()
        });

        // Save to localStorage
        localStorage.setItem('lobbyLink_user', JSON.stringify(userData));

        // Go to lobby
        window.location.href = 'lobby.html';

    } catch (err) {
        console.error("Login error:", err);
        alert("Could not log in right now. Check your connection and try again.");
        enterBtn.disabled = false;
        enterBtn.textContent = 'ENTER THE LOBBY';
    }
});

// ==========================================
// USERNAME → COLOR
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
