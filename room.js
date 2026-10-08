// ==========================================
// IMPORTS
// ==========================================
import { firebaseConfig } from './fireBaseConfig.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getDatabase, ref, set, update, remove, onValue, 
    get, push
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// ==========================================
// FIREBASE INIT
// ==========================================
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ==========================================
// GET USER + ROOM ID
// ==========================================
const savedUser = localStorage.getItem('lobbyLink_user');
if (!savedUser) window.location.href = 'index.html';
const user = JSON.parse(savedUser);

let roomId = new URLSearchParams(window.location.search).get('room');
if (!roomId) roomId = localStorage.getItem('lobbyLink_currentRoom');
if (!roomId) {
    alert("No room found. Redirecting to lobby.");
    window.location.href = 'lobby.html';
}
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
async function ensureInRoom() {
    const roomRef = ref(db, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
        await set(roomRef, {
            status: 'open',
            createdAt: Date.now(),
            players: {}
        });
    }

    await update(ref(db, `rooms/${roomId}/players/${user.username}`), {
        uid: user.uid,
        rank: user.rank,
        avatarColor: user.avatarColor,
        joinedAt: Date.now()
    });
}
ensureInRoom();

// ==========================================
// SQUAD BAR
// ==========================================
const playersRef = ref(db, `rooms/${roomId}/players`);
onValue(playersRef, (snapshot) => {
    if (!snapshot.exists()) {
        // Room was deleted by another player — boot us out
        alert("The room was closed.");
        window.location.href = 'lobby.html';
        return;
    }

    const players = snapshot.val() || {};
    const playerList = Object.keys(players);

    squadBar.innerHTML = '';
    playerList.forEach((username) => {
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

    if (playerList.length >= 4) {
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
    
    const sortedMessages = Object.entries(messages)
        .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

    sortedMessages.forEach(([key, msg]) => {
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
});

// ==========================================
// LEAVE ROOM (STRICT: Nuke if last one)
// ==========================================
leaveBtn.addEventListener('click', async () => {
    if (!confirm("Leave the squad room?")) return;

    // Remove ourselves
    await remove(ref(db, `rooms/${roomId}/players/${user.username}`));

    // Check remaining players
    const snap = await get(ref(db, `rooms/${roomId}/players`));
    const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;

    if (remaining === 0) {
        // We're the last one — delete the whole room
        await remove(ref(db, `rooms/${roomId}`));
        console.log("Room deleted (last player left)");
    } else {
        // Others still here — just reopen it
        await update(ref(db, `rooms/${roomId}`), { status: 'open' });
    }

    localStorage.removeItem('lobbyLink_currentRoom');
    window.location.href = 'lobby.html';
});

// ==========================================
// LAUNCH BLOOD STRIKE
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
// CLEANUP ON CLOSE
// ==========================================
window.addEventListener('beforeunload', async () => {
    // Remove ourselves
    await remove(ref(db, `rooms/${roomId}/players/${user.username}`));

    // Check if we were the last one
    const snap = await get(ref(db, `rooms/${roomId}/players`));
    const remaining = snap.exists() ? Object.keys(snap.val()).length : 0;

    if (remaining === 0) {
        remove(ref(db, `rooms/${roomId}`));
    }
});