const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { GameEngine, PHASES } = require('./game-engine');

async function runE2E() {
  console.log('🧪 Starting End-to-End WebSocket Test...');

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const engine = new GameEngine(['Name a cold place']);

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'host_create_room') {
        const room = engine.createRoom(ws.id || 'host');
        ws.roomCode = room.code;
        ws.isHost = true;
        ws.send(JSON.stringify({ type: 'room_created', roomCode: room.code, room: engine.serializeRoom(room) }));
      } else if (msg.type === 'player_join') {
        const res = engine.joinRoom(msg.roomCode, msg.playerId, msg.playerName);
        ws.roomCode = res.room.code;
        ws.playerId = res.player.id;
        ws.send(JSON.stringify({ type: 'join_success', roomCode: res.room.code, player: res.player }));
      } else if (msg.type === 'host_start_round') {
        engine.startRound(ws.roomCode);
        const serialized = engine.serializeRoom(engine.getRoom(ws.roomCode));
        for (const client of wss.clients) {
          if (client.roomCode === ws.roomCode) {
            client.send(JSON.stringify({ type: 'room_state', room: serialized }));
          }
        }
      } else if (msg.type === 'player_submit_answer') {
        engine.submitAnswer(ws.roomCode, ws.playerId, msg.answer);
      } else if (msg.type === 'host_score_round') {
        const res = engine.scoreRound(ws.roomCode);
        const serialized = engine.serializeRoom(engine.getRoom(ws.roomCode));
        for (const client of wss.clients) {
          if (client.roomCode === ws.roomCode) {
            client.send(JSON.stringify({ type: 'round_scored', result: res.result, room: serialized }));
          }
        }
      }
    });
  });

  await new Promise(resolve => server.listen(3999, resolve));

  const hostWs = new WebSocket('ws://localhost:3999');
  let roomCode;

  await new Promise((resolve) => {
    hostWs.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'room_created') {
        roomCode = msg.roomCode;
        console.log(`✓ Room created with code: ${roomCode}`);
        resolve();
      }
    });
    hostWs.on('open', () => {
      hostWs.send(JSON.stringify({ type: 'host_create_room' }));
    });
  });

  // Connect 3 player phone clients
  const p1 = new WebSocket('ws://localhost:3999');
  const p2 = new WebSocket('ws://localhost:3999');
  const p3 = new WebSocket('ws://localhost:3999');

  await Promise.all([
    new Promise(res => p1.on('open', () => { p1.send(JSON.stringify({ type: 'player_join', roomCode, playerId: 'p1', playerName: 'Alice' })); p1.once('message', res); })),
    new Promise(res => p2.on('open', () => { p2.send(JSON.stringify({ type: 'player_join', roomCode, playerId: 'p2', playerName: 'Bob' })); p2.once('message', res); })),
    new Promise(res => p3.on('open', () => { p3.send(JSON.stringify({ type: 'player_join', roomCode, playerId: 'p3', playerName: 'Charlie' })); p3.once('message', res); }))
  ]);
  console.log('✓ 3 players joined the room successfully');

  // Host starts round
  hostWs.send(JSON.stringify({ type: 'host_start_round' }));
  await new Promise(r => setTimeout(r, 100));

  // Players submit answers: Alice and Bob say "Antarctica", Charlie says "My freezer"
  p1.send(JSON.stringify({ type: 'player_submit_answer', answer: 'Antarctica' }));
  p2.send(JSON.stringify({ type: 'player_submit_answer', answer: 'antarctica' }));
  p3.send(JSON.stringify({ type: 'player_submit_answer', answer: 'My freezer' }));
  await new Promise(r => setTimeout(r, 100));

  // Host scores round
  const scoredPromise = new Promise(resolve => {
    hostWs.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'round_scored') resolve(msg);
    });
  });

  hostWs.send(JSON.stringify({ type: 'host_score_round' }));
  const scoredMsg = await scoredPromise;

  console.log('✓ Scored round result:');
  console.log(`  - Majority answer: "${scoredMsg.result.majorityAnswer}"`);
  console.log(`  - Winning players: ${scoredMsg.result.winningPlayerIds.join(', ')}`);
  console.log(`  - Black sheep recipient: ${scoredMsg.result.blackSheepRecipientId}`);

  if (scoredMsg.result.majorityAnswer === 'Antarctica' &&
      scoredMsg.result.winningPlayerIds.length === 2 &&
      scoredMsg.result.blackSheepRecipientId === 'p3') {
    console.log('🎉 E2E TEST PASSED! All game flow and scoring mechanics working flawlessly.');
  } else {
    console.error('❌ E2E TEST FAILED: unexpected result', scoredMsg);
    process.exit(1);
  }

  hostWs.close();
  p1.close();
  p2.close();
  p3.close();
  server.close();
  process.exit(0);
}

runE2E().catch(err => {
  console.error(err);
  process.exit(1);
});
