// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, ref, set, update, remove, onValue, 
    onDisconnect, get, push 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==========================================
// FIREBASE INIT
// ==========================================
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// GET USER
// ==========================================
const savedUser = localStorage.getItem('lobbyLink_user');
if (!savedUser) window.location.href = 'index.html';
const user = JSON.parse(savedUser);

// ==========================================
// UI REFERENCES
// ==========================================
const findBtn = document.getElementById('findBtn');
const actionHint = document.getElementById('actionHint');
const noTeamModal = document.getElementById('noTeamModal');
const searchingModal = document.getElementById('searchingModal');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const cancelSearchBtn = document.getElementById('cancelSearchBtn');
const liveCountEl = document.getElementById('liveCount');
const searchRoomPlayers = document.getElementById('searchRoomPlayers');

// Fill header & profile
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
// LIVE PLAYER COUNTER
// ==========================================
onValue(ref(db, 'live_players'), (snapshot) => {
    const now = Date.now();
    let liveCount = 0;
    snapshot.forEach((child) => {
        const p = child.val();
        if (now - p.lastActive < 15000 && !p.roomId) liveCount++;
    });
    liveCountEl.textContent = liveCount;
});

// ==========================================
// STRICT CLEANUP: Delete stale rooms
// ==========================================
// Runs once on load. Kills any room older than 5 minutes that has 0 players.
async function cleanupStaleRooms() {
    const snap = await get(ref(db, 'rooms'));
    if (!snap.exists()) return;

    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;

    snap.forEach((child) => {
        const room = child.val();
        const playerCount = room.players ? Object.keys(room.players).length : 0;
        const createdAt = room.createdAt || 0;

        if (playerCount === 0 && (now - createdAt) > FIVE_MINUTES) {
            remove(ref(db, `rooms/${child.key}`));
            console.log("Cleaned stale room:", child.key);
        }
    });
}
cleanupStaleRooms();

// ==========================================
// FIND TEAMMATES BUTTON
// ==========================================
findBtn.addEventListener('click', async () => {
    if (isSearching) return;
    isSearching = true;
    findBtn.disabled = true;
    await findOrCreateRoom();
});

// ==========================================
// MATCHMAKING
// ==========================================
async function findOrCreateRoom() {
    const roomsRef = ref(db, 'rooms');
    const snapshot = await get(roomsRef);

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
        await createRoom();
    }
}

// ==========================================
// JOIN EXISTING ROOM
// ==========================================
async function joinRoom(roomId, roomData) {
    const playerCount = Object.keys(roomData.players || {}).length;

    await update(ref(db, `rooms/${roomId}/players/${user.username}`), {
        uid: user.uid,
        rank: user.rank,
        avatarColor: user.avatarColor,
        joinedAt: Date.now()
    });

    currentRoomId = roomId;
    localStorage.setItem('lobbyLink_currentRoom', roomId);

    if (playerCount + 1 >= 4) {
        await update(ref(db, `rooms/${roomId}`), { status: 'full' });
    }

    window.location.href = `room.html?room=${roomId}`;
}

// ==========================================
// CREATE A NEW ROOM
// ==========================================
async function createRoom() {
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
                joinedAt: Date.now()
            }
        }
    });

    currentRoomId = roomId;
    localStorage.setItem('lobbyLink_currentRoom', roomId);

    noTeamModal.classList.remove('hidden');
    noTeamModal.style.display = 'flex';
    findBtn.disabled = false;

    listenToOurRoom(roomId);
}

// ==========================================
// WATCH OUR ROOM
// ==========================================
function listenToOurRoom(roomId) {
    if (roomListenerUnsubscribe) roomListenerUnsubscribe();

    roomListenerUnsubscribe = onValue(ref(db, `rooms/${roomId}/players`), async (snapshot) => {
        if (!snapshot.exists()) {
            // Room was deleted (likely by us leaving or cleanup)
            return;
        }

        const players = snapshot.val() || {};
        const count = Object.keys(players).length;
        searchRoomPlayers.textContent = count;

        // If someone else joined, switch to "searching" modal
        if (count > 1) {
            noTeamModal.classList.add('hidden');
            noTeamModal.style.display = 'none';
            searchingModal.classList.remove('hidden');
            searchingModal.style.display = 'flex';
        }

        // If full, jump to room
        if (count >= 4) {
            window.location.href = `room.html?room=${roomId}`;
        }
    });
}

// ==========================================
// TRY AGAIN
// ==========================================
tryAgainBtn.addEventListener('click', async () => {
    noTeamModal.classList.add('hidden');
    noTeamModal.style.display = 'none';
    isSearching = false;
    findBtn.disabled = false;
});

// ==========================================
// CANCEL SEARCH (STRICT CLEANUP)
// ==========================================
cancelSearchBtn.addEventListener('click', async () => {
    await leaveCurrentRoom();
    window.location.href = 'lobby.html';
});

async function leaveCurrentRoom() {
    if (roomListenerUnsubscribe) {
        roomListenerUnsubscribe();
        roomListenerUnsubscribe = null;
    }

    if (currentRoomId) {
        // Remove ourselves
        await remove(ref(db, `rooms/${currentRoomId}/players/${user.username}`));

        // Check if room is empty
        const snap = await get(ref(db, `rooms/${currentRoomId}/players`));
        const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;

        if (remaining === 0) {
            // Nuke the room completely
            await remove(ref(db, `rooms/${currentRoomId}`));
        } else {
            // Keep it open for others
            await update(ref(db, `rooms/${currentRoomId}`), { status: 'open' });
        }
    }

    currentRoomId = null;
    localStorage.removeItem('lobbyLink_currentRoom');
    isSearching = false;
    findBtn.disabled = false;
}

// ==========================================
// CLEANUP ON CLOSE
// ==========================================
window.addEventListener('beforeunload', () => {
    stopHeartbeat();
    if (currentRoomId) {
        remove(ref(db, `rooms/${currentRoomId}/players/${user.username}`));
    }
});