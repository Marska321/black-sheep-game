const test = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, PHASES, normalizeAnswer } = require('./game-engine');

test('normalizeAnswer trims, lowercases and strips punctuation', () => {
  assert.equal(normalizeAnswer('  Apple!  '), 'apple');
  assert.equal(normalizeAnswer('United States...'), 'united states');
  assert.equal(normalizeAnswer('  "HOT DOG"  '), 'hot dog');
  assert.equal(normalizeAnswer(''), '');
});

test('Room creation and player joining', () => {
  const engine = new GameEngine(['What is your favorite color?']);
  const room = engine.createRoom('host-123');

  assert.ok(room.code);
  assert.equal(room.code.length, 4);
  assert.equal(room.phase, PHASES.LOBBY);

  const res1 = engine.joinRoom(room.code, 'p1', 'Alice');
  assert.equal(res1.success, true);
  assert.equal(res1.player.name, 'Alice');

  const res2 = engine.joinRoom(room.code, 'p2', 'Bob');
  assert.equal(res2.success, true);

  // Duplicate name resolution
  const res3 = engine.joinRoom(room.code, 'p3', 'Alice');
  assert.equal(res3.success, true);
  assert.equal(res3.player.name, 'Alice 2');

  assert.equal(room.players.size, 3);
});

test('Scoring: Clear majority awards wool tokens', () => {
  const engine = new GameEngine(['Name a red fruit']);
  const room = engine.createRoom('host-1');
  engine.joinRoom(room.code, 'p1', 'Alice');
  engine.joinRoom(room.code, 'p2', 'Bob');
  engine.joinRoom(room.code, 'p3', 'Charlie');
  engine.joinRoom(room.code, 'p4', 'Diana');

  engine.startRound(room.code);
  engine.submitAnswer(room.code, 'p1', 'Apple');
  engine.submitAnswer(room.code, 'p2', 'apple!');
  engine.submitAnswer(room.code, 'p3', ' APPLE ');
  engine.submitAnswer(room.code, 'p4', 'Strawberry');

  const { result } = engine.scoreRound(room.code);

  assert.equal(result.isTie, false);
  assert.equal(result.winningPlayerIds.length, 3);
  assert.ok(result.winningPlayerIds.includes('p1'));
  assert.ok(result.winningPlayerIds.includes('p2'));
  assert.ok(result.winningPlayerIds.includes('p3'));

  assert.equal(room.players.get('p1').score, 1);
  assert.equal(room.players.get('p2').score, 1);
  assert.equal(room.players.get('p3').score, 1);
  assert.equal(room.players.get('p4').score, 0);

  // Sole odd-one-out gets the Black Sheep!
  assert.equal(result.blackSheepRecipientId, 'p4');
  assert.equal(room.blackSheepHolderId, 'p4');
  assert.equal(room.players.get('p4').hasBlackSheep, true);
});

test('Scoring: Multiple unique answers means NO ONE gets the Black Sheep', () => {
  const engine = new GameEngine(['Name something cold']);
  const room = engine.createRoom('host-1');
  engine.joinRoom(room.code, 'p1', 'Alice');
  engine.joinRoom(room.code, 'p2', 'Bob');
  engine.joinRoom(room.code, 'p3', 'Charlie');
  engine.joinRoom(room.code, 'p4', 'Diana');

  engine.startRound(room.code);
  engine.submitAnswer(room.code, 'p1', 'Ice');
  engine.submitAnswer(room.code, 'p2', 'Ice');
  engine.submitAnswer(room.code, 'p3', 'Snow');
  engine.submitAnswer(room.code, 'p4', 'Antarctica');

  const { result } = engine.scoreRound(room.code);

  // Alice and Bob win majority
  assert.equal(result.winningPlayerIds.length, 2);

  // Both Charlie and Diana had unique answers, so neither is the sole odd-one-out
  assert.equal(result.blackSheepRecipientId, null);
  assert.equal(room.blackSheepHolderId, null);
});

test('Scoring: Tie between majorities results in 0 wool tokens', () => {
  const engine = new GameEngine(['Cats or dogs']);
  const room = engine.createRoom('host-1');
  engine.joinRoom(room.code, 'p1', 'Alice');
  engine.joinRoom(room.code, 'p2', 'Bob');
  engine.joinRoom(room.code, 'p3', 'Charlie');
  engine.joinRoom(room.code, 'p4', 'Diana');
  engine.joinRoom(room.code, 'p5', 'Eve');

  engine.startRound(room.code);
  engine.submitAnswer(room.code, 'p1', 'Cat');
  engine.submitAnswer(room.code, 'p2', 'Cat');
  engine.submitAnswer(room.code, 'p3', 'Dog');
  engine.submitAnswer(room.code, 'p4', 'Dog');
  engine.submitAnswer(room.code, 'p5', 'Parrot');

  const { result } = engine.scoreRound(room.code);

  assert.equal(result.isTie, true);
  assert.equal(result.winningPlayerIds.length, 0);

  // Nobody gets points
  for (const player of room.players.values()) {
    assert.equal(player.score, 0);
  }

  // Eve is the sole unique answer, so Eve gets Black Sheep!
  assert.equal(result.blackSheepRecipientId, 'p5');
  assert.equal(room.blackSheepHolderId, 'p5');
  assert.equal(room.players.get('p5').hasBlackSheep, true);
});

test('Black Sheep blocks win condition at target score', () => {
  const engine = new GameEngine(['Question']);
  const room = engine.createRoom('host-1', { targetScore: 8 });
  engine.joinRoom(room.code, 'p1', 'Alice');
  engine.joinRoom(room.code, 'p2', 'Bob');
  engine.joinRoom(room.code, 'p3', 'Charlie');

  // Alice already has 7 points and has the Black Sheep
  const alice = room.players.get('p1');
  alice.score = 7;
  alice.hasBlackSheep = true;
  room.blackSheepHolderId = 'p1';

  // Alice and Bob both answer 'Yes', Charlie answers 'No'
  engine.startRound(room.code);
  engine.submitAnswer(room.code, 'p1', 'Yes');
  engine.submitAnswer(room.code, 'p2', 'Yes');
  engine.submitAnswer(room.code, 'p3', 'No');

  const { result } = engine.scoreRound(room.code);

  // Alice gets an 8th point, Charlie becomes the new Black Sheep!
  // Since Charlie becomes the new Black Sheep, Alice is freed and CAN win!
  assert.equal(alice.score, 8);
  assert.equal(result.blackSheepRecipientId, 'p3');
  assert.equal(room.phase, PHASES.GAME_OVER);
  assert.equal(room.winner.id, 'p1');
});

test('Player retaining Black Sheep cannot win even with 8 points', () => {
  const engine = new GameEngine(['Question']);
  const room = engine.createRoom('host-1', { targetScore: 8 });
  engine.joinRoom(room.code, 'p1', 'Alice');
  engine.joinRoom(room.code, 'p2', 'Bob');
  engine.joinRoom(room.code, 'p3', 'Charlie');
  engine.joinRoom(room.code, 'p4', 'Diana');

  const alice = room.players.get('p1');
  alice.score = 7;
  alice.hasBlackSheep = true;
  room.blackSheepHolderId = 'p1';

  // Alice and Bob answer 'Yes'. Charlie answers 'Maybe', Diana answers 'Sure'.
  // Charlie and Diana both have unique answers -> neither is sole odd-one-out.
  // So Alice REMAINS the Black Sheep!
  engine.startRound(room.code);
  engine.submitAnswer(room.code, 'p1', 'Yes');
  engine.submitAnswer(room.code, 'p2', 'Yes');
  engine.submitAnswer(room.code, 'p3', 'Maybe');
  engine.submitAnswer(room.code, 'p4', 'Sure');

  const { result } = engine.scoreRound(room.code);

  assert.equal(alice.score, 8);
  assert.equal(alice.hasBlackSheep, true);
  assert.equal(room.blackSheepHolderId, 'p1');
  // Alice cannot win because she holds the Black Sheep!
  assert.equal(result.winner, null);
  assert.notEqual(room.phase, PHASES.GAME_OVER);
});
