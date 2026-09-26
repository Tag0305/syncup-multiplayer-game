import { describe, expect, it } from "vitest";
import {
  GameError,
  advancePhase,
  classifyAnswerMatch,
  damerauLevenshtein,
  handleScheduledTransition,
  lockHostSetup,
  normalizeAnswer,
  revealAnswers,
  saveHostSetup,
  setUpAnotherGame,
  startGame,
  submitAnswer,
  type HostSetupInput,
} from "../src/game/game-engine";
import { addPlayer, createInitialRoomState, expireDisconnectedPlayers, makePlayer, markPlayerConnected, markPlayerDisconnected } from "../src/game/lobby";
import { buildLeaderboard, toPublicSnapshot, type PrivateRoomState } from "../src/game/room-state";

function makeTestPlayer(id: string, nickname: string, joinOrder: number, role: "host" | "player" = "player") {
  return makePlayer({ playerId: id, nickname, reconnectTokenHash: `hash-${id}`, joinOrder, role, now: 1_000 });
}

function room(competitorCount = 1): PrivateRoomState {
  const state = createInitialRoomState({ roomId: "room", roomCode: "K7M4PX", creator: makeTestPlayer("host", "Tagore", 1, "host"), now: 1_000 });
  markPlayerConnected(state, "host", 1_001);
  for (let index = 1; index <= competitorCount; index += 1) {
    addPlayer(state, makeTestPlayer(`p${index}`, `Player ${index}`, index + 1), 1_010 + index);
    markPlayerConnected(state, `p${index}`, 1_100 + index);
  }
  return state;
}

function setupPairs(answer = "Biryani"): HostSetupInput[] {
  return Array.from({ length: 5 }, (_, index) => ({
    question: `What is my choice number ${index + 1}?`,
    answer: index === 0 ? answer : `Answer ${index + 1}`,
  }));
}

function prepare(state: PrivateRoomState, pairs = setupPairs()): void {
  saveHostSetup(state, "host", pairs, 1_200);
  lockHostSetup(state, "host", 1_300);
}

function startPrepared(state: PrivateRoomState, now = 2_000, pairs = setupPairs()): void {
  prepare(state, pairs);
  startGame(state, "host", now);
}

function submitAndReveal(state: PrivateRoomState, answers: Record<string, string>, now: number): void {
  let shouldReveal = false;
  Object.entries(answers).forEach(([playerId, answer], index) => {
    shouldReveal = submitAnswer(state, playerId, answer, now + index);
  });
  expect(shouldReveal).toBe(true);
  expect(revealAnswers(state, now + 100)).toBe(true);
}

function match(playerAnswer: string, acceptedAnswers: string[]) {
  return classifyAnswerMatch(normalizeAnswer(playerAnswer), acceptedAnswers.map(normalizeAnswer));
}

describe("host-authored game engine", () => {
  it("normalizes Unicode, case, spacing, and harmless outer punctuation", () => {
    expect(normalizeAnswer("  ...BIRYANI!!! ")).toBe("biryani");
    expect(normalizeAnswer("Rock-paper-scissors")).toBe("rock-paper-scissors");
    expect(normalizeAnswer("  ‘Ice   Cream’  ")).toBe("ice cream");
    expect(normalizeAnswer("Ｂｉｒｙａｎｉ")).toBe("biryani");
    expect(normalizeAnswer("Rock—Paper")).toBe("rock-paper");
  });

  it.each([
    ["exact", "Biryani", ["Biryani"], "exact"],
    ["capitalization", "BIRYANI", ["Biryani"], "exact"],
    ["whitespace", "  biryani  ", ["Biryani"], "exact"],
    ["outer punctuation", "Biryani!", ["Biryani"], "exact"],
    ["accepted alternative", "Black", ["Blue", "Black"], "exact"],
    ["single-word partial", "Biriyani", ["Mutton Biriyani"], "partial"],
    ["partial phrase", "Fried Rice", ["Chicken Fried Rice"], "partial"],
    ["one-edit spelling", "Biryani", ["Biriyani"], "typo"],
    ["missing-letter spelling", "Criket", ["Cricket"], "typo"],
    ["transposed spelling", "Bangalroe", ["Bangalore"], "typo"],
    ["different answer", "Pizza", ["Biryani"], null],
    ["short dangerous fuzzy case", "Glue", ["Blue"], null],
    ["character substring", "red", ["Bored"], null],
  ])("matches %s deterministically", (_case, playerAnswer, acceptedAnswers, expected) => {
    expect(match(playerAnswer as string, acceptedAnswers as string[])).toBe(expected);
  });

  it("uses adjacent transpositions in the bounded edit-distance calculation", () => {
    expect(damerauLevenshtein("bangalore", "bangalroe")).toBe(1);
  });

  it("creates one immutable host role and begins with blank setup", () => {
    const state = room();
    expect(state.phase).toBe("setup");
    expect(state.originalHostPlayerId).toBe("host");
    expect(state.players.host.role).toBe("host");
    expect(state.hostQuestions).toEqual([]);
  });

  it("requires exactly five complete question-and-answer pairs", () => {
    const state = room();
    expect(() => saveHostSetup(state, "host", setupPairs().slice(0, 4), 2_000)).toThrowError(/exactly five/i);
    expect(() => saveHostSetup(state, "host", setupPairs().map((pair, index) => index === 2 ? { ...pair, question: "   " } : pair), 2_000)).toThrowError(/question must/i);
    expect(() => saveHostSetup(state, "host", setupPairs().map((pair, index) => index === 2 ? { ...pair, answer: "   " } : pair), 2_000)).toThrowError(/answer must/i);
  });

  it("lets only the host edit and lock setup, and blocks edits after lock", () => {
    const state = room();
    expect(() => saveHostSetup(state, "p1", setupPairs(), 2_000)).toThrowError(GameError);
    saveHostSetup(state, "host", setupPairs("Pizza"), 2_100);
    saveHostSetup(state, "host", setupPairs("Biryani"), 2_200);
    expect(state.hostQuestions[0].primaryAnswer.rawAnswer).toBe("Biryani");
    expect(() => lockHostSetup(state, "p1", 2_300)).toThrowError(/original host/i);
    lockHostSetup(state, "host", 2_400);
    expect(state.phase).toBe("lobby");
    expect(state.setupStatus).toBe("locked");
    expect(() => saveHostSetup(state, "host", setupPairs("Changed"), 2_500)).toThrowError();
    expect(state.hostQuestions[0].primaryAnswer.rawAnswer).toBe("Biryani");
  });

  it("locks up to four deduplicated accepted alternatives with the primary answer", () => {
    const state = room();
    const pairs = setupPairs("Blue");
    pairs[0] = { ...pairs[0], acceptedAnswers: [" Black ", "BLACK!", "Navy", "Azure"] };
    saveHostSetup(state, "host", pairs, 2_000);
    expect(state.hostQuestions[0].acceptedAlternatives.map((answer) => answer.rawAnswer)).toEqual(["Black", "Navy", "Azure"]);
    const tooMany = setupPairs("Blue");
    tooMany[0] = { ...tooMany[0], acceptedAnswers: ["Black", "Navy", "Azure", "Teal", "Cyan"] };
    expect(() => saveHostSetup(room(), "host", tooMany, 2_000)).toThrowError(/no more than 4 alternative/i);
  });

  it("allows only the host to start after lock with one connected competitor", () => {
    const unlocked = room();
    expect(() => startGame(unlocked, "host", 2_000)).toThrowError(/screen/i);
    const noCompetitor = room(0);
    prepare(noCompetitor);
    expect(() => startGame(noCompetitor, "host", 2_000)).toThrowError(/one participating player/i);
    const state = room();
    prepare(state);
    expect(() => startGame(state, "p1", 2_000)).toThrowError(/original host/i);
    startGame(state, "host", 2_000);
    expect(state.gamePlayerIds).toEqual(["p1"]);
    expect(state.eligiblePlayerIds).toEqual(["p1"]);
    expect(state.phaseEndsAt).toBe(47_000);
  });

  it("uses the five host-created questions in their original order", () => {
    const state = room();
    const pairs = setupPairs().map((pair, index) => ({ ...pair, question: `Ordered question ${index + 1}`, answer: `Locked ${index + 1}` }));
    startPrepared(state, 2_000, pairs);
    for (let round = 1; round <= 5; round += 1) {
      expect(state.currentQuestion?.text).toBe(`Ordered question ${round}`);
      submitAndReveal(state, { p1: `Locked ${round}` }, round * 10_000);
      advancePhase(state, round * 10_000 + 200);
      advancePhase(state, round * 10_000 + 300);
    }
    expect(state.phase).toBe("final");
  });

  it("never accepts an answer from the host", () => {
    const state = room();
    startPrepared(state);
    expect(() => submitAnswer(state, "host", "Biryani", 2_100)).toThrowError(/participating players/i);
    expect(state.answers.host).toBeUndefined();
  });

  it("locks one player answer and enforces the 60-character limit", () => {
    const state = room();
    startPrepared(state);
    expect(() => submitAnswer(state, "p1", "x".repeat(61), 2_100)).toThrowError(/1 to 60/);
    expect(submitAnswer(state, "p1", "Biryani", 2_200)).toBe(true);
    expect(() => submitAnswer(state, "p1", "Another", 2_300)).toThrowError(/already locked/i);
  });

  it("rejects answers at or after the authoritative server deadline", () => {
    const state = room();
    startPrepared(state, 10_000);
    expect(() => submitAnswer(state, "p1", "Biryani", 55_000)).toThrowError(/time has expired/i);
    expect(state.answers.p1).toBeUndefined();
  });

  it("awards exactly 100 for a normalized host match and zero otherwise", () => {
    const state = room(3);
    startPrepared(state);
    submitAndReveal(state, { p1: " biryani! ", p2: "Pizza", p3: "BIRYANI" }, 3_000);
    expect(state.roundResults[0].revealedAnswers.map(({ matched, pointsAwarded }) => ({ matched, pointsAwarded }))).toEqual([
      { matched: true, pointsAwarded: 100 },
      { matched: false, pointsAwarded: 0 },
      { matched: true, pointsAwarded: 100 },
    ]);
    expect(state.players.host.score).toBe(0);
  });

  it("scores aliases, whole-word partials, and typos once on the server", () => {
    const state = room(4);
    const pairs = setupPairs("Mutton Biriyani");
    pairs[0] = { ...pairs[0], acceptedAnswers: ["Black"] };
    startPrepared(state, 2_000, pairs);
    submitAndReveal(state, { p1: "Black", p2: "Biriyani", p3: "Biryani", p4: "Pizza" }, 3_000);
    expect(state.roundResults[0].revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([100, 100, 100, 0]);
    expect(state.players.p1.score).toBe(100);
    expect(state.players.p2.score).toBe(100);
    expect(state.players.p3.score).toBe(100);
    expect(state.players.p4.score).toBe(0);
  });

  it("reveals at the 45-second deadline and gives no-answer players zero", () => {
    const state = room(2);
    startPrepared(state, 10_000);
    submitAnswer(state, "p1", "Biryani", 11_000);
    expect(handleScheduledTransition(state, 54_999)).toBe(false);
    expect(handleScheduledTransition(state, 55_000)).toBe(true);
    expect(state.phase).toBe("reveal");
    expect(state.roundResults[0].revealedAnswers[1]).toMatchObject({ playerId: "p2", answer: "No answer", matched: false, pointsAwarded: 0 });
  });

  it("reveals early when every required competitor answers", () => {
    const state = room(2);
    startPrepared(state);
    expect(submitAnswer(state, "p1", "Biryani", 2_100)).toBe(false);
    expect(submitAnswer(state, "p2", "Nope", 2_200)).toBe(true);
    expect(revealAnswers(state, 2_201)).toBe(true);
    expect(state.phase).toBe("reveal");
  });

  it("rejects stale and duplicate reveals without scoring twice", () => {
    const state = room();
    startPrepared(state);
    const questionVersion = state.phaseVersion;
    submitAnswer(state, "p1", "Biryani", 2_100);
    expect(revealAnswers(state, 2_200, questionVersion - 1)).toBe(false);
    expect(revealAnswers(state, 2_300, questionVersion)).toBe(true);
    expect(state.players.p1.score).toBe(100);
    expect(revealAnswers(state, 50_000, questionVersion)).toBe(false);
    state.scheduledTransition = { kind: "answer_deadline", deadline: 47_000, phaseVersion: questionVersion };
    expect(handleScheduledTransition(state, 50_000)).toBe(false);
    expect(state.players.p1.score).toBe(100);
  });

  it("completes five rounds with a maximum score of 500 and excludes the host", () => {
    const pairs = setupPairs().map((pair, index) => ({ ...pair, answer: `Answer ${index + 1}` }));
    const state = room();
    startPrepared(state, 2_000, pairs);
    for (let round = 1; round <= 5; round += 1) {
      submitAndReveal(state, { p1: `Answer ${round}` }, round * 10_000);
      expect(advancePhase(state, round * 10_000 + 200)).toBe(true);
      expect(advancePhase(state, round * 10_000 + 300)).toBe(true);
    }
    expect(state.phase).toBe("final");
    expect(state.roundResults).toHaveLength(5);
    expect(state.players.p1.score).toBe(500);
    expect(state.players.host.score).toBe(0);
    expect(buildLeaderboard(state).map((entry) => entry.playerId)).toEqual(["p1"]);
  });

  it("uses shared ranks and shared winners for tied competitors", () => {
    const state = room(2);
    startPrepared(state);
    submitAndReveal(state, { p1: "Biryani", p2: "biryani!" }, 3_000);
    state.phase = "final";
    state.status = "finished";
    const leaderboard = buildLeaderboard(state);
    expect(leaderboard.map((entry) => entry.rank)).toEqual([1, 1]);
    const snapshot = toPublicSnapshot(state, 4_000);
    expect(snapshot.phase === "final" && snapshot.winnerPlayerIds).toEqual(["p1", "p2"]);
  });

  it("preserves a submitted answer through reconnect and includes it after expiry", () => {
    const state = room(2);
    startPrepared(state);
    submitAnswer(state, "p2", "Biryani", 2_100);
    markPlayerDisconnected(state, "p2", 3_000);
    expect(state.answers.p2.rawAnswer).toBe("Biryani");
    expireDisconnectedPlayers(state, 33_000);
    expect(state.players.p2.presence).toBe("left");
    submitAnswer(state, "p1", "Nope", 33_001);
    revealAnswers(state, 33_002);
    expect(state.roundResults[0].revealedAnswers.find((answer) => answer.playerId === "p2")).toMatchObject({ answer: "Biryani", matched: true, pointsAwarded: 100 });
    advancePhase(state, 33_100);
    advancePhase(state, 33_200);
    expect(state.eligiblePlayerIds).toEqual(["p1"]);
  });

  it("keeps the original host identity after host grace expiry while an active game continues", () => {
    const state = room();
    startPrepared(state);
    markPlayerDisconnected(state, "host", 3_000);
    const result = expireDisconnectedPlayers(state, 33_000);
    expect(result.hostChanged).toBe(false);
    expect(state.hostPlayerId).toBe("host");
    expect(state.originalHostPlayerId).toBe("host");
    submitAnswer(state, "p1", "Biryani", 33_100);
    revealAnswers(state, 33_101);
    expect(state.players.p1.score).toBe(100);
    expect(handleScheduledTransition(state, 41_101)).toBe(true);
    expect(state.phase).toBe("leaderboard");
    expect(handleScheduledTransition(state, 56_101)).toBe(true);
    expect(state.phase).toBe("question");
    expect(state.roundNumber).toBe(2);
  });

  it("starts another game in blank setup while keeping the room, host, and active players", () => {
    const state = room(2);
    startPrepared(state);
    state.phase = "final";
    state.status = "finished";
    state.players.p1.score = 400;
    state.players.p2.score = 200;
    setUpAnotherGame(state, "host", 20_000);
    expect(state.roomCode).toBe("K7M4PX");
    expect(state.originalHostPlayerId).toBe("host");
    expect(Object.keys(state.players)).toEqual(["host", "p1", "p2"]);
    expect(state.phase).toBe("setup");
    expect(state.setupStatus).toBe("editing");
    expect(state.hostQuestions).toEqual([]);
    expect(state.players.p1.score).toBe(0);
    expect(state.players.p2.score).toBe(0);
    expect(() => startGame(state, "host", 20_100)).toThrowError();
  });
});
