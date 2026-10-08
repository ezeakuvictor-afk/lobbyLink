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
const findBtn = document.getElementById('findBtn');
const findBtnText = document.getElementById('findBtnText');
const actionHint = document.getElementById('actionHint');
const noTeamModal = document.getElementById('noTeamModal');
const searchingModal = document.getElementById('searchingModal');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const cancelSearchBtn = document.getElementById('cancelSearchBtn');
const liveCountEl = document.getElementById('liveCount');
const counterLabel = document.getElementById('counterLabel');
const searchRoomPlayers = document.getElementById('searchRoomPlayers');

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
// LIVE COUNTER + SMART BUTTON
// ==========================================
onValue(ref(db, 'live_players'), (snapshot) => {
    const now = Date.now();
    liveCount = 0;
    snapshot.forEach((child) => {
        const p = child.val();
        if (now - p.lastActive < 15000 && !p.roomId) liveCount++;
    });

    liveCountEl.textContent = liveCount;
    counterLabel.textContent = liveCount === 1 ? 'active player' : 'active players';

    // Enable the button only when 2+ players are active
    if (liveCount >= 2) {
        findBtn.disabled = false;
        findBtnText.textContent = 'FIND TEAMMATES';
        actionHint.textContent = `${liveCount} players online. Tap to start the queue.`;
    } else {
        findBtn.disabled = true;
        findBtnText.textContent = 'WAITING FOR PLAYERS';
        actionHint.textContent = 'Waiting for another player to come online...';
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

// ==========================================
// JOIN
// ==========================================
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

// ==========================================
// CREATE WITH GRACE
// ==========================================
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
// TRY AGAIN
// ==========================================
tryAgainBtn.addEventListener('click', async () => {
    noTeamModal.classList.add('hidden');
    noTeamModal.style.display = 'none';
    isSearching = false;
    if (liveCount >= 2) findBtn.disabled = false;
});

// ==========================================
// CANCEL
// ==========================================
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