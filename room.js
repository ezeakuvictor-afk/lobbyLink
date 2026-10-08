// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, ref, set, update, remove, onValue, get, push
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// CONFIG (tweak these)
// ==========================================
const INACTIVITY_WARN_MS = 20000;  // 20s of silence → show warning
const INACTIVITY_KICK_MS = 10000;  // 10s more silence after warning → kick

// ==========================================
// GET USER + ROOM
// ==========================================
const savedUser = localStorage.getItem('lobbyLink_user');
if (!savedUser) window.location.href = 'index.html';
const user = JSON.parse(savedUser);

let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) roomId = localStorage.getItem('lobbyLink_currentRoom');
if (!roomId) window.location.href = 'lobby.html';
localStorage.setItem('lobbyLink_currentRoom', roomId);

// ==========================================
// UI
// ==========================================
const roomCodeEl    = document.getElementById('roomCode');
const squadBar      = document.getElementById('squadBar');
const chatMessages  = document.getElementById('chatMessages');
const chatForm      = document.getElementById('chatForm');
const messageInput  = document.getElementById('messageInput');
const leaveBtn      = document.getElementById('leaveBtn');
const launchBtn     = document.getElementById('launchBtn');
const launchModal   = document.getElementById('launchModal');
const doLaunchBtn   = document.getElementById('doLaunchBtn');
const closeLaunchBtn= document.getElementById('closeLaunchBtn');

// ==========================================
// ROOM CODE
// ==========================================
function generateShortCode(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
    }
    return `BSC-${Math.abs(hash % 9000) + 1000}`;
}
roomCodeEl.textContent = generateShortCode(roomId);

// ==========================================
// JOIN ROOM
// ==========================================
let roomHeartbeat = null;
function pulseInRoom() {
    update(ref(db, `rooms/${roomId}/players/${user.username}`), {
        lastActive: Date.now()
    }).catch(() => {});
}

async function ensureInRoom() {
    const roomRef = ref(db, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
        await set(roomRef, { status: 'open', createdAt: Date.now(), players: {} });
    }

    await update(ref(db, `rooms/${roomId}/players/${user.username}`), {
        uid: user.uid,
        rank: user.rank,
        avatarColor: user.avatarColor,
        joinedAt: Date.now(),
        lastActive: Date.now()
    });

    roomHeartbeat = setInterval(pulseInRoom, 5000);
}
ensureInRoom();

// ==========================================
// SQUAD BAR
// ==========================================
onValue(ref(db, `rooms/${roomId}/players`), (snapshot) => {
    if (!snapshot.exists()) {
        window.location.href = 'lobby.html';
        return;
    }

    const players = snapshot.val() || {};
    const now = Date.now();

    const livePlayers = Object.keys(players).filter((username) => {
        const p = players[username];
        return (now - (p.lastActive || 0)) < 15000;
    });

    squadBar.innerHTML = '';
    livePlayers.forEach((username) => {
        const p = players[username];
        const isMe = username === user.username;

        const card = document.createElement('div');
        card.className = `squad-member ${isMe ? 'squad-me' : ''}`;

        const topRow = document.createElement('div');
        topRow.className = 'squad-top';

        const avatar = document.createElement('div');
        avatar.className = 'squad-avatar';
        avatar.style.background = p.avatarColor || '#4a90e2';
        avatar.textContent = username[0].toUpperCase();

        const info = document.createElement('div');
        info.className = 'squad-info';
        info.innerHTML = `
            <span class="squad-name">${username}</span>
            <span class="squad-rank">${p.rank}</span>
        `;

        topRow.appendChild(avatar);
        topRow.appendChild(info);
        card.appendChild(topRow);

        const uidLine = document.createElement('div');
        uidLine.className = 'squad-uid';
        uidLine.textContent = p.uid;
        card.appendChild(uidLine);

        if (isMe) {
            const youBadge = document.createElement('div');
            youBadge.className = 'badge-you';
            youBadge.textContent = 'YOU';
            card.appendChild(youBadge);
        } else {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn-copy-uid';
            copyBtn.textContent = 'COPY UID';
            copyBtn.onclick = async () => {
                try {
                    await navigator.clipboard.writeText(p.uid);
                    copyBtn.textContent = 'COPIED!';
                    copyBtn.classList.add('copied');
                    setTimeout(() => {
                        copyBtn.textContent = 'COPY UID';
                        copyBtn.classList.remove('copied');
                    }, 1500);
                } catch (err) {
                    prompt("Copy this UID:", p.uid);
                }
            };
            card.appendChild(copyBtn);
        }

        squadBar.appendChild(card);
    });

    if (livePlayers.length >= 4) {
        update(ref(db, `rooms/${roomId}`), { status: 'full' });
    }
});

// ==========================================
// CHAT
// ==========================================
const messagesRef = ref(db, `rooms/${roomId}/messages`);

onValue(messagesRef, (snapshot) => {
    chatMessages.innerHTML = '';
    const messages = snapshot.val() || {};
    const sorted = Object.entries(messages)
        .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

    sorted.forEach(([key, msg]) => {
        const isMe = msg.username === user.username;
        const msgDiv = document.createElement('div');
        msgDiv.className = `msg ${isMe ? 'msg-me' : 'msg-other'}`;

        const header = document.createElement('div');
        header.className = 'msg-header';
        header.textContent = `${msg.username}.${msg.uid || '0000'}`;
        msgDiv.appendChild(header);

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.textContent = msg.text;
        msgDiv.appendChild(bubble);

        const time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = msg.timestamp || '';
        msgDiv.appendChild(time);
        
        chatMessages.appendChild(msgDiv);
    });
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
});

// ==========================================
// SEND MESSAGE (resets inactivity timer)
// ==========================================
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;
    
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + 
                    now.getMinutes().toString().padStart(2, '0');
    
    await push(messagesRef, {
        username: user.username,
        uid: user.uid,
        text: text,
        timestamp: timeStr,
        createdAt: Date.now()
    });
    
    messageInput.value = '';
    messageInput.focus();

    // Reset inactivity clock
    resetInactivity();
});

// ==========================================
// INACTIVITY WATCHDOG
// ==========================================
let inactivityTimer = null;
let warningTimer = null;
let warningToast = null;

function resetInactivity() {
    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);
    removeWarningToast();

    // 20s → show warning
    warningTimer = setTimeout(() => {
        showWarningToast();
        // 10s more → kick
        inactivityTimer = setTimeout(() => {
            kickForInactivity();
        }, INACTIVITY_KICK_MS);
    }, INACTIVITY_WARN_MS);
}

function showWarningToast() {
    removeWarningToast();
    warningToast = document.createElement('div');
    warningToast.className = 'toast-warning';
    warningToast.innerHTML = `
        <span>You've been quiet for a while. Still here?</span>
        <button id="imHereBtn">I'M HERE</button>
    `;
    document.body.appendChild(warningToast);

    const btn = document.getElementById('imHereBtn');
    btn.onclick = () => {
        removeWarningToast();
        resetInactivity();
    };
}

function removeWarningToast() {
    if (warningToast && warningToast.parentNode) {
        warningToast.parentNode.removeChild(warningToast);
    }
    warningToast = null;
}

async function kickForInactivity() {
    removeWarningToast();
    await remove(ref(db, `rooms/${roomId}/players/${user.username}`));
    localStorage.removeItem('lobbyLink_currentRoom');
    alert("You were removed from the room due to inactivity.");
    window.location.href = 'lobby.html';
}

// Start the watchdog
resetInactivity();

// Also reset on any typing (not just sending)
messageInput.addEventListener('input', resetInactivity);

// ==========================================
// LEAVE
// ==========================================
leaveBtn.addEventListener('click', async () => {
    if (!confirm("Leave the squad room?")) return;
    if (roomHeartbeat) clearInterval(roomHeartbeat);
    removeWarningToast();
    clearTimeout(inactivityTimer);
    clearTimeout(warningTimer);

    await remove(ref(db, `rooms/${roomId}/players/${user.username}`));
    const snap = await get(ref(db, `rooms/${roomId}/players`));
    const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;

    if (remaining === 0) {
        await remove(ref(db, `rooms/${roomId}`));
    } else {
        await update(ref(db, `rooms/${roomId}`), { status: 'open' });
    }

    localStorage.removeItem('lobbyLink_currentRoom');
    window.location.href = 'lobby.html';
});

// ==========================================
// LAUNCH
// ==========================================
const BLOODSTRIKE_PACKAGE = 'com.netease.gp.bloodstrike';

launchBtn.addEventListener('click', () => {
    launchModal.classList.remove('hidden');
    launchModal.style.display = 'flex';
});

closeLaunchBtn.addEventListener('click', () => {
    launchModal.classList.add('hidden');
    launchModal.style.display = 'none';
});

doLaunchBtn.addEventListener('click', () => {
    launchModal.classList.add('hidden');
    launchModal.style.display = 'none';

    const deepLink = `bloodstrike://`;
    const playStoreUrl = `https://play.google.com/store/apps/details?id=${BLOODSTRIKE_PACKAGE}`;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = deepLink;
    document.body.appendChild(iframe);

    setTimeout(() => {
        document.body.removeChild(iframe);
        if (!document.hidden) window.location.href = playStoreUrl;
    }, 1500);
});

// ==========================================
// CLEANUP
// ==========================================
window.addEventListener('beforeunload', () => {
    if (roomHeartbeat) clearInterval(roomHeartbeat);
    remove(ref(db, `rooms/${roomId}/players/${user.username}`));
});
