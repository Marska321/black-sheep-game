/**
 * Black Sheep - Game Engine
 * Pure game logic: rooms, state machine, answer clustering, and Black Sheep scoring rules.
 */

const questionsData = require('./questions.json');

const PHASES = {
  LOBBY: 'LOBBY',
  QUESTION: 'QUESTION',
  REVEAL: 'REVEAL',
  SCORED: 'SCORED',
  GAME_OVER: 'GAME_OVER'
};

const DEFAULT_TARGET_SCORE = 8;
const DEFAULT_ROUND_TIMER = 30; // seconds

/**
 * Normalizes an answer string for fair grouping.
 * Trims, lowercases, removes extraneous punctuation and multiple spaces.
 */
function normalizeAnswer(text) {
  if (!text) return '';
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Generates an uppercase 4-letter room code.
 */
function generateRoomCode(existingRooms = {}) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude I and O to prevent confusion
  let code;
  let attempts = 0;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
    attempts++;
  } while (existingRooms[code] && attempts < 1000);
  return code;
}

class GameEngine {
  constructor(questions = questionsData) {
    this.rooms = new Map();
    this.questions = questions;
  }

  createRoom(hostId, options = {}) {
    const existing = Object.fromEntries(this.rooms);
    const roomCode = generateRoomCode(existing);

    const room = {
      code: roomCode,
      hostId: hostId,
      phase: PHASES.LOBBY,
      players: new Map(), // playerId -> { id, name, score: 0, hasBlackSheep: false, answer: null, isConnected: true }
      blackSheepHolderId: null,
      usedQuestions: new Set(),
      currentQuestion: null,
      questionIndex: 0,
      targetScore: options.targetScore || DEFAULT_TARGET_SCORE,
      roundTimerSeconds: options.roundTimerSeconds || DEFAULT_ROUND_TIMER,
      roundStartTime: null,
      lastRoundResult: null,
      winner: null
    };

    this.rooms.set(roomCode, room);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(roomCode.toUpperCase().trim()) || null;
  }

  joinRoom(roomCode, playerId, playerName) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };

    const cleanName = (playerName || 'Sheep').trim().substring(0, 18);

    // If player already exists with this ID (reconnect)
    if (room.players.has(playerId)) {
      const existing = room.players.get(playerId);
      existing.isConnected = true;
      existing.name = cleanName;
      return { success: true, room, player: existing, isReconnect: true };
    }

    // Check if name is taken
    let finalName = cleanName;
    const names = Array.from(room.players.values()).map(p => p.name.toLowerCase());
    let counter = 2;
    while (names.includes(finalName.toLowerCase())) {
      finalName = `${cleanName} ${counter}`;
      counter++;
    }

    const player = {
      id: playerId,
      name: finalName,
      score: 0,
      hasBlackSheep: false,
      answer: null,
      isConnected: true
    };

    room.players.set(playerId, player);
    return { success: true, room, player, isReconnect: false };
  }

  removePlayer(roomCode, playerId) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    if (room.phase === PHASES.LOBBY) {
      room.players.delete(playerId);
    } else {
      const player = room.players.get(playerId);
      if (player) {
        player.isConnected = false;
      }
    }
    return room;
  }

  getRandomQuestion(room) {
    const available = this.questions.filter(q => !room.usedQuestions.has(q));
    if (available.length === 0) {
      room.usedQuestions.clear();
      return this.questions[Math.floor(Math.random() * this.questions.length)];
    }
    const picked = available[Math.floor(Math.random() * available.length)];
    room.usedQuestions.add(picked);
    return picked;
  }

  startRound(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.players.size < 2) {
      return { error: 'Need at least 2 players to start' };
    }

    room.phase = PHASES.QUESTION;
    room.currentQuestion = this.getRandomQuestion(room);
    room.questionIndex += 1;
    room.roundStartTime = Date.now();
    room.lastRoundResult = null;

    // Reset player round answers
    for (const player of room.players.values()) {
      player.answer = null;
    }

    return { success: true, room };
  }

  submitAnswer(roomCode, playerId, answerText) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase !== PHASES.QUESTION) {
      return { error: 'Not currently accepting answers' };
    }

    const player = room.players.get(playerId);
    if (!player) return { error: 'Player not found in room' };

    player.answer = (answerText || '').trim();

    // Check if all connected players have answered
    const activePlayers = Array.from(room.players.values()).filter(p => p.isConnected);
    const answeredCount = activePlayers.filter(p => p.answer !== null && p.answer !== '').length;
    const allAnswered = answeredCount >= activePlayers.length;

    return {
      success: true,
      room,
      allAnswered,
      answeredCount,
      totalActive: activePlayers.length
    };
  }

  /**
   * Evaluates answers and computes scores according to Herd Mentality / Black Sheep rules:
   * 1. Majority answer gets 1 wool token.
   * 2. If tie for majority, no one scores wool.
   * 3. Sole odd-one-out player receives the Black Sheep.
   * 4. Black Sheep blocks winning at target score.
   */
  scoreRound(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };

    const activePlayers = Array.from(room.players.values()).filter(p => p.isConnected);

    // Group answers by normalized representation
    // Map: normalized -> { rawAnswers: string[], playerIds: string[] }
    const answerGroups = new Map();

    for (const player of activePlayers) {
      const raw = player.answer || '(no answer)';
      const norm = normalizeAnswer(raw);
      const key = norm || '__empty__';

      if (!answerGroups.has(key)) {
        answerGroups.set(key, {
          displayAnswer: raw,
          count: 0,
          playerIds: []
        });
      }
      const group = answerGroups.get(key);
      group.count += 1;
      group.playerIds.push(player.id);
    }

    // 1. Determine Majority
    let maxCount = 0;
    for (const group of answerGroups.values()) {
      if (group.count > maxCount) {
        maxCount = group.count;
      }
    }

    // Collect all groups that reached maxCount
    const topGroups = Array.from(answerGroups.values()).filter(g => g.count === maxCount);

    const isTie = topGroups.length > 1;
    let winningPlayerIds = [];
    let majorityAnswer = null;

    if (!isTie && topGroups.length === 1 && maxCount > 0) {
      majorityAnswer = topGroups[0].displayAnswer;
      winningPlayerIds = topGroups[0].playerIds;
      // Award 1 wool token to each player in the winning majority
      for (const pid of winningPlayerIds) {
        const player = room.players.get(pid);
        if (player) {
          player.score += 1;
        }
      }
    }

    // 2. Determine Odd-One-Out (Black Sheep 🖤)
    // Find groups that have EXACTLY 1 player
    const uniqueGroups = Array.from(answerGroups.values()).filter(g => g.count === 1);
    let newBlackSheepRecipientId = null;
    let blackSheepTransferred = false;

    if (uniqueGroups.length === 1) {
      // Exactly ONE player gave an unmatched answer!
      newBlackSheepRecipientId = uniqueGroups[0].playerIds[0];
      if (room.blackSheepHolderId !== newBlackSheepRecipientId) {
        // Clear old holder
        if (room.blackSheepHolderId && room.players.has(room.blackSheepHolderId)) {
          room.players.get(room.blackSheepHolderId).hasBlackSheep = false;
        }
        // Set new holder
        room.blackSheepHolderId = newBlackSheepRecipientId;
        const newHolder = room.players.get(newBlackSheepRecipientId);
        if (newHolder) {
          newHolder.hasBlackSheep = true;
        }
        blackSheepTransferred = true;
      }
    }

    // 3. Check for Winner
    // Winner must have score >= targetScore AND NOT hold the Black Sheep
    const eligibleWinners = activePlayers.filter(
      p => p.score >= room.targetScore && p.id !== room.blackSheepHolderId
    );

    let winner = null;
    if (eligibleWinners.length === 1) {
      winner = eligibleWinners[0];
      room.phase = PHASES.GAME_OVER;
      room.winner = winner;
    } else if (eligibleWinners.length > 1) {
      // Tie at or above target score!
      // Sort descending by score
      eligibleWinners.sort((a, b) => b.score - a.score);
      if (eligibleWinners[0].score > eligibleWinners[1].score) {
        winner = eligibleWinners[0];
        room.phase = PHASES.GAME_OVER;
        room.winner = winner;
      } else {
        // Tied for top! Increase target by 1 to play sudden death
        room.targetScore = eligibleWinners[0].score + 1;
        room.phase = PHASES.SCORED;
      }
    } else {
      room.phase = PHASES.SCORED;
    }

    // Prepare serializable summary
    const formattedGroups = Array.from(answerGroups.values()).map(g => ({
      answer: g.displayAnswer,
      count: g.count,
      players: g.playerIds.map(pid => {
        const p = room.players.get(pid);
        return { id: pid, name: p ? p.name : 'Unknown' };
      }),
      isWinner: !isTie && winningPlayerIds.includes(g.playerIds[0])
    }));

    // Sort groups by count descending
    formattedGroups.sort((a, b) => b.count - a.count);

    const result = {
      question: room.currentQuestion,
      isTie,
      maxCount,
      majorityAnswer,
      winningPlayerIds,
      blackSheepRecipientId: newBlackSheepRecipientId,
      currentBlackSheepId: room.blackSheepHolderId,
      blackSheepTransferred,
      groups: formattedGroups,
      winner: winner ? { id: winner.id, name: winner.name, score: winner.score } : null,
      targetScore: room.targetScore
    };

    room.lastRoundResult = result;
    return { success: true, room, result };
  }

  serializeRoom(room) {
    if (!room) return null;
    return {
      code: room.code,
      phase: room.phase,
      currentQuestion: room.currentQuestion,
      questionIndex: room.questionIndex,
      targetScore: room.targetScore,
      roundTimerSeconds: room.roundTimerSeconds,
      blackSheepHolderId: room.blackSheepHolderId,
      winner: room.winner ? { id: room.winner.id, name: room.winner.name, score: room.winner.score } : null,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        hasBlackSheep: p.hasBlackSheep,
        hasAnswered: p.answer !== null && p.answer !== '',
        isConnected: p.isConnected
      })),
      lastRoundResult: room.lastRoundResult
    };
  }
}

module.exports = {
  GameEngine,
  PHASES,
  normalizeAnswer,
  generateRoomCode
};
