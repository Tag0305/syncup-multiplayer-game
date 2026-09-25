import { describe, expect, it } from "vitest";
import {
  GameError,
  advancePhase,
  handleScheduledTransition,
  normalizeAnswer,
  playAgain,
  pointsForMatchSize,
  revealAnswers,
  startGame,
  submitAnswer,
} from "../src/game/game-engine";
import { addPlayer, createInitialRoomState, expireDisconnectedPlayers, makePlayer, markPlayerConnected, markPlayerDisconnected } from "../src/game/lobby";
import { QUESTION_BANK } from "../src/game/questions";
import { buildLeaderboard, toPublicSnapshot, type PrivateRoomState } from "../src/game/room-state";

function makeTestPlayer(id: string, nickname: string, joinOrder: number, role: "host" | "player" = "player") {
  return makePlayer({ playerId: id, nickname, reconnectTokenHash: `hash-${id}`, joinOrder, role, now: 1_000 });
}

function room(playerCount = 2): PrivateRoomState {
  const state = createInitialRoomState({ roomId: "room", roomCode: "K7M4PX", creator: makeTestPlayer("p1", "Maya", 1, "host"), now: 1_000 });
  markPlayerConnected(state, "p1", 1_001);
  for (let index = 2; index <= playerCount; index += 1) {
    addPlayer(state, makeTestPlayer(`p${index}`, `Player ${index}`, index), 1_000 + index);
    markPlayerConnected(state, `p${index}`, 1_100 + index);
  }
  return state;
}

function answerAll(state: PrivateRoomState, answers: string[], now = 2_000) {
  answers.forEach((answer, index) => {
    const shouldReveal = submitAnswer(state, `p${index + 1}`, answer, now + index);
    if (shouldReveal) revealAnswers(state, now + index);
  });
}

describe("Phase 4 game engine", () => {
  it("ships approximately 120 unique family-friendly prompts", () => {
    expect(QUESTION_BANK).toHaveLength(120);
    expect(new Set(QUESTION_BANK.map((question) => question.id)).size).toBe(120);
    expect(new Set(QUESTION_BANK.map((question) => question.text)).size).toBe(120);
  });

  it("normalizes case, spacing, Unicode, and harmless outer punctuation only", () => {
    expect(normalizeAnswer("  ...CHECK   Phone!!! ")).toBe("check phone");
    expect(normalizeAnswer("Rock-paper-scissors")).toBe("rock-paper-scissors");
    expect(normalizeAnswer("  ‘Ice Cream’  ")).toBe("ice cream");
  });

  it("uses the exact match-size scoring table", () => {
    expect([1, 2, 3, 4, 8].map(pointsForMatchSize)).toEqual([0, 100, 200, 300, 300]);
  });

  it("allows only the host to start and requires two players", () => {
    expect(() => startGame(room(1), "p1", 2_000)).toThrowError(/two players/i);
    expect(() => startGame(room(2), "p2", 2_000)).toThrowError(GameError);
    const state = room(2);
    startGame(state, "p1", 2_000);
    expect(state.phase).toBe("question");
    expect(state.gamePlayerIds).toEqual(["p1", "p2"]);
  });

  it("selects exactly five non-duplicate questions and sets a 45-second deadline", () => {
    const state = room(2);
    startGame(state, "p1", 10_000);
    expect(state.selectedQuestionIds).toHaveLength(5);
    expect(new Set(state.selectedQuestionIds).size).toBe(5);
    expect(state.phaseEndsAt).toBe(55_000);
    expect(state.scheduledTransition).toEqual({ kind: "answer_deadline", deadline: 55_000, phaseVersion: state.phaseVersion });
  });

  it("accepts one answer per eligible player and enforces the 60-character limit", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    expect(submitAnswer(state, "p1", "Check phone", 2_100)).toBe(false);
    expect(() => submitAnswer(state, "p1", "Another", 2_200)).toThrowError(/already locked/i);
    expect(() => submitAnswer(state, "p2", "x".repeat(61), 2_300)).toThrowError(/1–60/);
  });

  it("reveals early and scores solo, pair, triple, and groups of four correctly", () => {
    const solo = room(2); startGame(solo, "p1", 2_000); answerAll(solo, ["Phone", "Book"]);
    expect(solo.roundResults[0].revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([0, 0]);

    const pair = room(2); startGame(pair, "p1", 2_000); answerAll(pair, [" Phone! ", "phone"]);
    expect(pair.roundResults[0].revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([100, 100]);

    const triple = room(3); startGame(triple, "p1", 2_000); answerAll(triple, ["Pizza", "pizza.", " PIZZA "]);
    expect(triple.roundResults[0].revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([200, 200, 200]);

    const four = room(4); startGame(four, "p1", 2_000); answerAll(four, ["Beach", "beach", "Beach!", " beach "]);
    expect(four.roundResults[0].revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([300, 300, 300, 300]);
  });

  it("does not leak private answers in answering snapshots", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    submitAnswer(state, "p1", "Secret answer!", 2_100);
    const serialized = JSON.stringify(toPublicSnapshot(state, 2_200));
    expect(serialized).not.toContain("Secret answer");
    expect(serialized).not.toContain("secret answer");
    expect(serialized).not.toContain("rawAnswer");
    expect(serialized).not.toContain("normalizedAnswer");
    expect(serialized).not.toContain("reconnectTokenHash");
  });

  it("reveals submitted answers at the deadline and marks missing answers", () => {
    const state = room(2);
    startGame(state, "p1", 10_000);
    submitAnswer(state, "p1", "Phone", 11_000);
    expect(handleScheduledTransition(state, 54_999)).toBe(false);
    expect(handleScheduledTransition(state, 55_000)).toBe(true);
    expect(state.phase).toBe("reveal");
    expect(state.roundResults[0].revealedAnswers[1].answer).toBe("No answer");
    expect(state.players.p2.currentAnswerStatus).toBe("timed_out");
  });

  it("ignores stale or duplicate alarms and never double-scores", () => {
    const state = room(2);
    startGame(state, "p1", 10_000);
    const questionVersion = state.phaseVersion;
    submitAnswer(state, "p1", "Phone", 11_000);
    submitAnswer(state, "p2", "Phone", 11_001);
    revealAnswers(state, 11_002, questionVersion);
    const scores = [state.players.p1.score, state.players.p2.score];
    expect(revealAnswers(state, 55_000, questionVersion)).toBe(false);
    expect(handleScheduledTransition(state, 11_003)).toBe(false);
    expect([state.players.p1.score, state.players.p2.score]).toEqual(scores);
  });

  it("completes all five rounds, accumulates scores, and supports tied winners", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    for (let round = 1; round <= 5; round += 1) {
      answerAll(state, ["Same", "same!"], 3_000 * round);
      expect(state.phase).toBe("reveal");
      expect(advancePhase(state, 3_000 * round + 100)).toBe(true);
      expect(state.phase).toBe("leaderboard");
      expect(advancePhase(state, 3_000 * round + 200)).toBe(true);
    }
    expect(state.phase).toBe("final");
    expect(state.status).toBe("finished");
    expect(state.roundResults).toHaveLength(5);
    expect(state.players.p1.score).toBe(500);
    expect(buildLeaderboard(state).map((entry) => entry.rank)).toEqual([1, 1]);
    const snapshot = toPublicSnapshot(state, 20_000);
    expect(snapshot.phase === "final" && snapshot.winnerPlayerIds).toEqual(["p1", "p2"]);
  });

  it("keeps a submitted answer after disconnect and removes an expired player from future rounds", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    submitAnswer(state, "p2", "Phone", 2_100);
    markPlayerDisconnected(state, "p2", 3_000);
    expect(state.answers.p2.rawAnswer).toBe("Phone");
    expireDisconnectedPlayers(state, 33_000);
    expect(state.players.p2.presence).toBe("left");
    revealAnswers(state, 33_001);
    advancePhase(state, 33_100);
    advancePhase(state, 33_200);
    expect(state.phase).toBe("question");
    expect(state.eligiblePlayerIds).toEqual(["p1"]);
  });

  it("transfers host during gameplay after grace expiry", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    markPlayerDisconnected(state, "p1", 3_000);
    const result = expireDisconnectedPlayers(state, 33_000);
    expect(result.hostChanged).toBe(true);
    expect(state.hostPlayerId).toBe("p2");
  });

  it("Play Again keeps the room and players, resets scores, and selects a fresh game", () => {
    const state = room(2);
    startGame(state, "p1", 2_000);
    const firstQuestions = [...state.selectedQuestionIds];
    state.phase = "final"; state.status = "finished"; state.players.p1.score = 900; state.players.p2.score = 500;
    playAgain(state, "p1", 20_000);
    expect(state.roomCode).toBe("K7M4PX");
    expect(state.phase).toBe("question");
    expect(state.roundNumber).toBe(1);
    expect(state.players.p1.score).toBe(0);
    expect(state.players.p2.score).toBe(0);
    expect(state.selectedQuestionIds.some((id) => firstQuestions.includes(id))).toBe(false);
  });
});
