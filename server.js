const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const QRCode = require('qrcode');
const { GameEngine, PHASES } = require('./game-engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const engine = new GameEngine();

app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Render/hosting platforms
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// Dynamic QR code generator endpoint
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send('Missing text parameter');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('Failed to generate QR code');
  }
});

// Friendly routes
app.get('/join/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

/**
 * WebSocket Management
 */
function sendJson(ws, type, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

function broadcastToRoom(roomCode, type, data = {}) {
  const room = engine.getRoom(roomCode);
  if (!room) return;
  const payload = JSON.stringify({ type, ...data });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
      client.send(payload);
    }
  }
}

function broadcastRoomState(roomCode) {
  const room = engine.getRoom(roomCode);
  if (!room) return;
  const serialized = engine.serializeRoom(room);
  broadcastToRoom(roomCode, 'room_state', { room: serialized });
}

// Keep-alive heartbeat (prevents Render/proxy timeout drops)
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return sendJson(ws, 'error', { message: 'Invalid JSON payload' });
    }

    const { type, roomCode, playerId, playerName, answer, options } = msg;

    switch (type) {
      case 'host_create_room': {
        const room = engine.createRoom(ws.id || 'host', options);
        ws.roomCode = room.code;
        ws.isHost = true;
        sendJson(ws, 'room_created', {
          roomCode: room.code,
          room: engine.serializeRoom(room)
        });
        break;
      }

      case 'player_join': {
        const result = engine.joinRoom(roomCode, playerId, playerName);
        if (result.error) {
          return sendJson(ws, 'join_error', { message: result.error });
        }

        ws.roomCode = result.room.code;
        ws.playerId = result.player.id;
        ws.isHost = false;

        sendJson(ws, 'join_success', {
          roomCode: result.room.code,
          player: result.player,
          room: engine.serializeRoom(result.room)
        });

        // Notify entire room (host + other players) of updated lobby
        broadcastRoomState(result.room.code);
        break;
      }

      case 'host_start_round': {
        if (!ws.isHost) return;
        const result = engine.startRound(ws.roomCode);
        if (result.error) {
          return sendJson(ws, 'error', { message: result.error });
        }
        broadcastRoomState(ws.roomCode);
        break;
      }

      case 'player_submit_answer': {
        const result = engine.submitAnswer(ws.roomCode, ws.playerId, answer);
        if (result.error) {
          return sendJson(ws, 'error', { message: result.error });
        }

        sendJson(ws, 'answer_confirmed', { answer: answer });

        // Update progress for all in room
        broadcastToRoom(ws.roomCode, 'answer_progress', {
          answeredCount: result.answeredCount,
          totalActive: result.totalActive,
          allAnswered: result.allAnswered
        });

        // If everyone answered, alert host screen
        if (result.allAnswered) {
          broadcastToRoom(ws.roomCode, 'all_answers_in');
        }
        break;
      }

      case 'host_score_round': {
        if (!ws.isHost) return;
        const result = engine.scoreRound(ws.roomCode);
        if (result.error) {
          return sendJson(ws, 'error', { message: result.error });
        }
        broadcastToRoom(ws.roomCode, 'round_scored', {
          result: result.result,
          room: engine.serializeRoom(result.room)
        });
        break;
      }

      case 'host_next_round': {
        if (!ws.isHost) return;
        const result = engine.startRound(ws.roomCode);
        if (result.error) {
          return sendJson(ws, 'error', { message: result.error });
        }
        broadcastRoomState(ws.roomCode);
        break;
      }

      case 'host_reset_game': {
        if (!ws.isHost) return;
        const room = engine.getRoom(ws.roomCode);
        if (room) {
          room.phase = PHASES.LOBBY;
          room.blackSheepHolderId = null;
          room.winner = null;
          room.currentQuestion = null;
          room.usedQuestions.clear();
          for (const p of room.players.values()) {
            p.score = 0;
            p.hasBlackSheep = false;
            p.answer = null;
          }
          broadcastRoomState(ws.roomCode);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomCode && ws.playerId) {
      engine.removePlayer(ws.roomCode, ws.playerId);
      broadcastRoomState(ws.roomCode);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐑 Black Sheep server running at http://localhost:${PORT}`);
});
