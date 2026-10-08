// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, ref, set, update, remove, onValue, 
    onDisconnect, get, push 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// USER
// ==========================================
const savedUser = localStorage.getItem('lobbyLink_user');
if (!savedUser) window.location.href = 'index.html';
const user = JSON.parse(savedUser);

// ==========================================
// UI
// ==========================================
const findBtn        = document.getElementById('findBtn');
const findBtnText    = document.getElementById('findBtnText');
const actionHint     = document.getElementById('actionHint');
const noTeamModal    = document.getElementById('noTeamModal');
const searchingModal = document.getElementById('searchingModal');
const tryAgainBtn    = document.getElementById('tryAgainBtn');
const cancelSearchBtn= document.getElementById('cancelSearchBtn');
const liveCountEl    = document.getElementById('liveCount');
const counterLabel   = document.getElementById('counterLabel');
const searchRoomPlayers = document.getElementById('searchRoomPlayers');
const queueStatus    = document.getElementById('queueStatus');
const logoutBtn      = document.getElementById('logoutBtn');

document.getElementById('userName').textContent = user.username;
document.getElementById('userAvatar').textContent = user.username[0].toUpperCase();
document.getElementById('userAvatar').style.background = user.avatarColor;
document.getElementById('profileName').textContent = user.username;
document.getElementById('profileAvatar').textContent = user.username[0].toUpperCase();
document.getElementById('profileAvatar').style.background = user.avatarColor;
document.getElementById('profileRank').textContent = `🥇 ${user.rank}`;
document.getElementById('profileUid').textContent = `UID: ${user.uid}`;

// ==========================================
// STATE
// ==========================================
let currentRoomId = null;
let heartbeatInterval = null;
let isSearching = false;
let roomListenerUnsubscribe = null;
let graceTimer = null;
let liveCount = 0;
const GRACE_PERIOD_MS = 5000;

// ==========================================
// LOGOUT
// ==========================================
logoutBtn.addEventListener('click', () => {
    if (!confirm("Log out of LobbyLink?")) return;
    localStorage.removeItem('lobbyLink_user');
    localStorage.removeItem('lobbyLink_currentRoom');
    stopHeartbeat();
    window.location.href = 'index.html';
});

// ==========================================
// HEARTBEAT
// ==========================================
function writePresence() {
    set(ref(db, 'live_players/' + user.username), {
        username: user.username,
        uid: user.uid,
        rank: user.rank,
        avatarColor: user.avatarColor,
        roomId: currentRoomId,
        lastActive: Date.now()
    });
}

function startHeartbeat() {
    writePresence();
    heartbeatInterval = setInterval(writePresence, 5000);
    onDisconnect(ref(db, 'live_players/' + user.username)).remove();
}

function stopHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    remove(ref(db, 'live_players/' + user.username));
}

startHeartbeat();

// ==========================================
// LIVE COUNTER + QUEUE STATUS + SMART BUTTON
// ==========================================
onValue(ref(db, 'live_players'), (snapshot) => {
    const now = Date.now();
    liveCount = 0;
    const activeNames = [];
    const queuingNames = [];

    snapshot.forEach((child) => {
        const p = child.val();
        if (now - p.lastActive < 15000 && !p.roomId) {
            liveCount++;
            activeNames.push(p.username);
        }
    });

    liveCountEl.textContent = liveCount;
    counterLabel.textContent = liveCount === 1 ? 'active player' : 'active players';

    // Smart button
    if (liveCount >= 2) {
        findBtn.disabled = false;
        findBtnText.textContent = 'FIND TEAMMATES';
        actionHint.textContent = `${liveCount} players online. Tap to start the queue.`;
    } else {
        findBtn.disabled = true;
        findBtnText.textContent = 'WAITING FOR PLAYERS';
        actionHint.textContent = 'Waiting for another player to come online...';
    }

    // Queue status text — only shows when someone is actively in a room
    const queuingSnap = snapshot; // We'll re-fetch rooms below
});

// Separate listener: watch all rooms to see who's actively queuing
onValue(ref(db, 'rooms'), (snapshot) => {
    if (!snapshot.exists()) {
        queueStatus.textContent = '';
        return;
    }

    const now = Date.now();
    const queuingPlayers = [];

    snapshot.forEach((child) => {
        const room = child.val();
        if (!room || !room.players) return;

        Object.keys(room.players).forEach((username) => {
            const p = room.players[username];
            if (p.lastActive && (now - p.lastActive) < 15000) {
                queuingPlayers.push(username);
            }
        });
    });

    if (queuingPlayers.length === 0) {
        queueStatus.textContent = '';
    } else if (queuingPlayers.includes(user.username)) {
        queueStatus.textContent = `You are queuing. ${queuingPlayers.length} player${queuingPlayers.length > 1 ? 's' : ''} in queue.`;
    } else {
        queueStatus.textContent = `${queuingPlayers.join(', ')} ${queuingPlayers.length === 1 ? 'is' : 'are'} searching for a room...`;
    }
});

// ==========================================
// FIND BUTTON
// ==========================================
findBtn.addEventListener('click', async () => {
    if (isSearching || liveCount < 2) return;
    isSearching = true;
    findBtn.disabled = true;
    await findOrCreateRoom();
});

// ==========================================
// MATCHMAKING
// ==========================================
async function findOrCreateRoom() {
    const snapshot = await get(ref(db, 'rooms'));
    let foundRoomId = null;
    let foundRoomData = null;

    if (snapshot.exists()) {
        snapshot.forEach((child) => {
            const room = child.val();
            if (!room || !room.players) return;
            const playerCount = Object.keys(room.players).length;

            if (room.status === 'open' && playerCount > 0 && playerCount < 4 && !foundRoomId) {
                if (!room.players[user.username]) {
                    foundRoomId = child.key;
                    foundRoomData = room;
                }
            }
        });
    }

    if (foundRoomId) {
        await joinRoom(foundRoomId, foundRoomData);
    } else {
        await createRoomWithGrace();
    }
}

async function joinRoom(roomId, roomData) {
    const playerCount = Object.keys(roomData.players || {}).length;

    await update(ref(db, `rooms/${roomId}/players/${user.username}`), {
        uid: user.uid,
        rank: user.rank,
        avatarColor: user.avatarColor,
        joinedAt: Date.now(),
        lastActive: Date.now()
    });

    currentRoomId = roomId;
    localStorage.setItem('lobbyLink_currentRoom', roomId);

    if (playerCount + 1 >= 4) {
        await update(ref(db, `rooms/${roomId}`), { status: 'full' });
    }

    window.location.href = `room.html?room=${roomId}`;
}

async function createRoomWithGrace() {
    const newRoomRef = push(ref(db, 'rooms'));
    const roomId = newRoomRef.key;

    await set(newRoomRef, {
        status: 'open',
        createdAt: Date.now(),
        players: {
            [user.username]: {
                uid: user.uid,
                rank: user.rank,
                avatarColor: user.avatarColor,
                joinedAt: Date.now(),
                lastActive: Date.now()
            }
        }
    });

    currentRoomId = roomId;
    localStorage.setItem('lobbyLink_currentRoom', roomId);

    searchingModal.classList.remove('hidden');
    searchingModal.style.display = 'flex';
    searchRoomPlayers.textContent = '1';

    if (roomListenerUnsubscribe) roomListenerUnsubscribe();
    roomListenerUnsubscribe = onValue(ref(db, `rooms/${roomId}/players`), (snap) => {
        if (!snap.exists()) return;
        const players = snap.val() || {};
        const count = Object.keys(players).length;
        searchRoomPlayers.textContent = count;

        if (count > 1) {
            clearTimeout(graceTimer);
            if (count >= 4) {
                update(ref(db, `rooms/${roomId}`), { status: 'full' });
            }
            window.location.href = `room.html?room=${roomId}`;
        }
    });

    graceTimer = setTimeout(async () => {
        const snap = await get(ref(db, `rooms/${roomId}/players`));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;

        if (count > 1) {
            window.location.href = `room.html?room=${roomId}`;
            return;
        }

        searchingModal.classList.add('hidden');
        searchingModal.style.display = 'none';
        noTeamModal.classList.remove('hidden');
        noTeamModal.style.display = 'flex';
        findBtn.disabled = false;
        isSearching = false;
    }, GRACE_PERIOD_MS);
}

// ==========================================
// TRY AGAIN / CANCEL
// ==========================================
tryAgainBtn.addEventListener('click', async () => {
    noTeamModal.classList.add('hidden');
    noTeamModal.style.display = 'none';
    isSearching = false;
    if (liveCount >= 2) findBtn.disabled = false;
});

cancelSearchBtn.addEventListener('click', async () => {
    clearTimeout(graceTimer);
    await leaveCurrentRoom();
    window.location.href = 'lobby.html';
});

async function leaveCurrentRoom() {
    if (roomListenerUnsubscribe) {
        roomListenerUnsubscribe();
        roomListenerUnsubscribe = null;
    }

    if (currentRoomId) {
        await remove(ref(db, `rooms/${currentRoomId}/players/${user.username}`));
        const snap = await get(ref(db, `rooms/${currentRoomId}/players`));
        const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;

        if (remaining === 0) {
            await remove(ref(db, `rooms/${currentRoomId}`));
        } else {
            await update(ref(db, `rooms/${currentRoomId}`), { status: 'open' });
        }
    }

    currentRoomId = null;
    localStorage.removeItem('lobbyLink_currentRoom');
    isSearching = false;
}

// ==========================================
// CLEANUP
// ==========================================
window.addEventListener('beforeunload', () => {
    stopHeartbeat();
    if (currentRoomId) {
        remove(ref(db, `rooms/${currentRoomId}/players/${user.username}`));
    }
});
