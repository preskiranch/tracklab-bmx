import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(__dirname, '..');
const distDirectory = path.join(rootDirectory, 'dist');
const port = Number(process.env.PORT ?? 10000);
const websocketPath = '/multiplayer';

const clients = new Map();
const rooms = new Map();
const challenges = new Map();

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function randomId(prefix, length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${value}`;
}

function sanitizeText(value, fallback, maxLength = 80) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return (text || fallback).slice(0, maxLength);
}

function sanitizeTrack(value) {
  if (!value || typeof value !== 'object') {
    return {
      id: 'unknown-track',
      name: 'Unselected track',
      country: 'Unknown',
      state: 'Unknown',
    };
  }

  return {
    id: sanitizeText(value.id, 'unknown-track', 120),
    name: sanitizeText(value.name, 'Unselected track', 120),
    country: sanitizeText(value.country, 'Unknown', 80),
    state: sanitizeText(value.state, 'Unknown', 80),
  };
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nullableFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeRaceState(value, client, room) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const riders = Array.isArray(value.riders)
    ? value.riders.slice(0, 8).map((rider, index) => {
      const colorName = ['lime', 'red', 'blue', 'yellow'].includes(rider?.colorName)
        ? rider.colorName
        : ['lime', 'red', 'blue', 'yellow'][index % 4];

      return {
        id: sanitizeText(rider?.id, `${client.id}:${index + 1}`, 120),
        playerId: Math.max(1, Math.min(8, Math.round(finiteNumber(rider?.playerId, index + 1)))),
        name: sanitizeText(rider?.name, `${client.name} ${index + 1}`, 64),
        colorName,
        accent: sanitizeText(rider?.accent, '#7ade36', 24),
        distance: Math.max(0, finiteNumber(rider?.distance, 0)),
        velocity: Math.max(0, finiteNumber(rider?.velocity, 0)),
        boost: Math.max(0, Math.min(1, finiteNumber(rider?.boost, 0))),
        air: Math.max(0, finiteNumber(rider?.air, 0)),
        pitch: Math.max(-45, Math.min(45, finiteNumber(rider?.pitch, 0))),
        phase: ['pedaling', 'airborne', 'landing'].includes(rider?.phase) ? rider.phase : 'pedaling',
        rank: Math.max(1, Math.min(64, Math.round(finiteNumber(rider?.rank, index + 1)))),
        finishedAt: nullableFiniteNumber(rider?.finishedAt),
        watts: Math.max(0, Math.round(finiteNumber(rider?.watts, 0))),
        cadence: nullableFiniteNumber(rider?.cadence),
        speedKph: nullableFiniteNumber(rider?.speedKph),
        signal: Math.max(0, Math.min(1, finiteNumber(rider?.signal, 0))),
        sampleAt: nullableFiniteNumber(rider?.sampleAt),
      };
    })
    : [];

  return {
    clientId: client.id,
    riderName: client.name,
    roomId: room.id,
    trackId: sanitizeText(value.trackId, room.track.id, 120),
    raceState: ['ready', 'racing', 'finished'].includes(value.raceState) ? value.raceState : 'ready',
    at: Date.now(),
    riders,
    summary: Array.isArray(value.summary) ? value.summary.slice(0, 16) : [],
  };
}

function publicRider(client) {
  return {
    id: client.id,
    name: client.name,
    available: client.available,
    bikeCount: client.bikeCount,
    track: client.track,
    roomId: client.roomId,
    lastSeen: client.lastSeen,
  };
}

function publicRoom(room) {
  const members = [...room.members]
    .map((clientId) => clients.get(clientId))
    .filter(Boolean)
    .map(publicRider);

  return {
    id: room.id,
    hostId: room.hostId,
    private: room.private,
    track: room.track,
    createdAt: room.createdAt,
    members,
    memberCount: members.length,
  };
}

function send(client, payload) {
  if (client?.socket?.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(payload));
  }
}

function broadcastLobby() {
  const payload = {
    type: 'lobby-state',
    riders: [...clients.values()].map(publicRider),
    rooms: [...rooms.values()].map(publicRoom),
  };

  clients.forEach((client) => send(client, payload));
}

function broadcastRoom(roomId, payload) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.members.forEach((clientId) => send(clients.get(clientId), payload));
}

function roomState(room) {
  return {
    type: 'room-state',
    room: publicRoom(room),
    messages: room.messages,
    raceStates: [...room.raceStates.values()],
  };
}

function leaveRoom(client, reason = 'left') {
  if (!client.roomId) {
    return;
  }

  const room = rooms.get(client.roomId);
  const oldRoomId = client.roomId;
  client.roomId = null;

  if (!room) {
    send(client, { type: 'room-left', roomId: oldRoomId, reason });
    return;
  }

  room.members.delete(client.id);
  room.raceStates.delete(client.id);
  if (room.hostId === client.id) {
    room.hostId = [...room.members][0] ?? null;
  }

  send(client, { type: 'room-left', roomId: oldRoomId, reason });

  if (room.members.size === 0) {
    rooms.delete(room.id);
    broadcastLobby();
    return;
  }

  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function joinRoom(client, room) {
  if (client.roomId && client.roomId !== room.id) {
    leaveRoom(client, 'joined-another-room');
  }

  room.members.add(client.id);
  client.roomId = room.id;
  client.track = room.track;
  broadcastRoom(room.id, roomState(room));
  broadcastLobby();
}

function createRoom(host, track, privateRoom = true) {
  let id = randomId('ROOM', 6);
  while (rooms.has(id)) {
    id = randomId('ROOM', 6);
  }

  const room = {
    id,
    hostId: host.id,
    private: privateRoom,
    track: sanitizeTrack(track ?? host.track),
    createdAt: Date.now(),
    members: new Set(),
    raceStates: new Map(),
    messages: [{
      id: randomId('MSG', 10),
      author: 'TrackLab',
      text: 'Private room opened.',
      at: new Date().toISOString(),
    }],
  };

  rooms.set(id, room);
  joinRoom(host, room);
  return room;
}

function sendChallenge(fromClient, targetClient, track, statusPrefix = 'Challenge sent') {
  const challenge = {
    id: randomId('CHAL', 8),
    fromId: fromClient.id,
    toId: targetClient.id,
    track: sanitizeTrack(track ?? fromClient.track),
    createdAt: Date.now(),
  };

  challenges.set(challenge.id, challenge);
  send(targetClient, {
    type: 'challenge-incoming',
    challenge,
    from: publicRider(fromClient),
  });
  send(fromClient, { type: 'challenge-status', message: `${statusPrefix} to ${targetClient.name}.` });
}

function handleClientMessage(client, rawMessage) {
  let message = null;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    send(client, { type: 'error', message: 'Invalid multiplayer message.' });
    return;
  }

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'hello' || message.type === 'presence') {
    client.name = sanitizeText(message.name, client.name, 64);
    client.available = Boolean(message.available);
    client.bikeCount = Math.max(0, Math.min(8, Number(message.bikeCount) || 0));
    client.track = sanitizeTrack(message.track ?? client.track);
    client.lastSeen = Date.now();

    if (message.type === 'hello') {
      send(client, {
        type: 'welcome',
        clientId: client.id,
        riders: [...clients.values()].map(publicRider),
        rooms: [...rooms.values()].map(publicRoom),
      });
    }

    broadcastLobby();
    return;
  }

  if (message.type === 'create-room') {
    createRoom(client, message.track, true);
    return;
  }

  if (message.type === 'join-room') {
    const roomId = sanitizeText(message.roomId, '', 32).toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      send(client, { type: 'room-error', message: `Room ${roomId || 'unknown'} is not available.` });
      return;
    }

    joinRoom(client, room);
    return;
  }

  if (message.type === 'leave-room') {
    leaveRoom(client);
    broadcastLobby();
    return;
  }

  if (message.type === 'room-track') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    room.track = sanitizeTrack(message.track);
    room.members.forEach((clientId) => {
      const member = clients.get(clientId);
      if (member) {
        member.track = room.track;
      }
    });
    broadcastRoom(room.id, roomState(room));
    broadcastLobby();
    return;
  }

  if (message.type === 'room-chat') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    const chatMessage = {
      id: randomId('MSG', 10),
      author: client.name,
      text: sanitizeText(message.text, '', 240),
      at: new Date().toISOString(),
    };

    if (!chatMessage.text) {
      return;
    }

    room.messages = [...room.messages, chatMessage].slice(-40);
    broadcastRoom(room.id, { type: 'room-chat', message: chatMessage, messages: room.messages });
    return;
  }

  if (message.type === 'race-sync') {
    if (!client.roomId) {
      return;
    }

    const room = rooms.get(client.roomId);
    if (!room) {
      return;
    }

    const raceState = sanitizeRaceState(message.state, client, room);
    if (!raceState) {
      return;
    }

    room.raceStates.set(client.id, raceState);
    broadcastRoom(room.id, { type: 'race-sync', state: raceState });
    return;
  }

  if (message.type === 'challenge') {
    const target = clients.get(sanitizeText(message.targetId, '', 80));
    if (!target || target.id === client.id) {
      send(client, { type: 'challenge-status', message: 'That rider is not online.' });
      return;
    }

    sendChallenge(client, target, message.track);
    return;
  }

  if (message.type === 'quick-match') {
    const candidates = [...clients.values()]
      .filter((candidate) => candidate.id !== client.id)
      .filter((candidate) => candidate.available)
      .filter((candidate) => candidate.socket.readyState === candidate.socket.OPEN);

    if (candidates.length === 0) {
      send(client, { type: 'challenge-status', message: 'No available riders are online yet. Stay available and try again.' });
      return;
    }

    const target = candidates[Math.floor(Math.random() * candidates.length)];
    sendChallenge(client, target, message.track, 'Quick match request sent');
    return;
  }

  if (message.type === 'challenge-response') {
    const challenge = challenges.get(sanitizeText(message.challengeId, '', 32));
    if (!challenge || challenge.toId !== client.id) {
      send(client, { type: 'challenge-status', message: 'Challenge is no longer available.' });
      return;
    }

    challenges.delete(challenge.id);
    const challenger = clients.get(challenge.fromId);
    if (!challenger) {
      send(client, { type: 'challenge-status', message: 'The challenger is no longer online.' });
      return;
    }

    if (!message.accepted) {
      send(challenger, { type: 'challenge-status', message: `${client.name} declined the challenge.` });
      send(client, { type: 'challenge-status', message: 'Challenge declined.' });
      return;
    }

    const room = createRoom(challenger, challenge.track, true);
    joinRoom(client, room);
    send(challenger, { type: 'challenge-status', message: `${client.name} accepted. Room ${room.id} is ready.` });
    send(client, { type: 'challenge-status', message: `Joined ${challenger.name}'s room.` });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (requestUrl.pathname === '/api/multiplayer/health') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      ok: true,
      clients: clients.size,
      rooms: rooms.size,
      websocketPath,
    }));
    return;
  }

  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const safePath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.resolve(distDirectory, `.${safePath}`);
  const withinDist = filePath.startsWith(distDirectory);
  const fallbackPath = path.join(distDirectory, 'index.html');
  const targetPath = withinDist ? filePath : fallbackPath;

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      throw new Error('Not a file');
    }

    const extension = path.extname(targetPath);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(targetPath).pipe(response);
  } catch {
    const indexHtml = await readFile(fallbackPath);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    response.end(indexHtml);
  }
}

const server = createServer((request, response) => {
  void serveStatic(request, response).catch((error) => {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  });
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
  const client = {
    id: randomId('RIDER', 10),
    socket,
    name: 'TrackLab Rider',
    available: false,
    bikeCount: 0,
    track: sanitizeTrack(null),
    roomId: null,
    lastSeen: Date.now(),
  };

  clients.set(client.id, client);
  send(client, {
    type: 'connected',
    clientId: client.id,
    websocketPath,
  });
  broadcastLobby();

  socket.on('message', (message) => handleClientMessage(client, message));
  socket.on('close', () => {
    leaveRoom(client, 'disconnected');
    clients.delete(client.id);
    broadcastLobby();
  });
});

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (requestUrl.pathname !== websocketPath) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(port, () => {
  console.log(`[cloud] TrackLab BMX web + multiplayer listening on :${port}`);
});
