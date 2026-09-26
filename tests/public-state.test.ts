import { describe, expect, it } from "vitest";
import { addPlayer, createInitialRoomState, makePlayer, markPlayerConnected } from "../src/game/lobby";
import { toClientSnapshot, toPublicSnapshot, type PrivateRoomState } from "../src/game/room-state";

function stateWithSecrets(phase: "setup" | "question" | "reveal" = "question"): PrivateRoomState {
  const host = makePlayer({ playerId: "host", nickname: "Tagore", reconnectTokenHash: "host-token-hash", joinOrder: 1, role: "host", now: 1 });
  const state = createInitialRoomState({ roomId: "room-id", roomCode: "K7M4PX", creator: host, now: 1 });
  markPlayerConnected(state, "host", 2);
  addPlayer(state, makePlayer({ playerId: "p1", nickname: "Alex", reconnectTokenHash: "player-token-hash", joinOrder: 2, role: "player", now: 2 }), 2);
  markPlayerConnected(state, "p1", 3);
  state.hostQuestions = Array.from({ length: 5 }, (_, index) => ({
    id: `host-question-${index + 1}`,
    question: `Private game question ${index + 1}?`,
    primaryAnswer: {
      rawAnswer: index === 0 ? "Saffron-code" : `Future-secret-${index + 1}`,
      normalizedAnswer: index === 0 ? "saffron-code" : `future-secret-${index + 1}`,
    },
    acceptedAlternatives: [{
      rawAnswer: index === 0 ? "Current-secret-alias" : `Future-alias-${index + 1}`,
      normalizedAnswer: index === 0 ? "current-secret-alias" : `future-alias-${index + 1}`,
    }],
  }));
  state.setupStatus = phase === "setup" ? "editing" : "locked";
  state.phase = phase;
  state.status = phase === "setup" ? "lobby" : "playing";
  state.roundNumber = phase === "setup" ? 0 : 1;
  state.phaseVersion = 4;
  state.currentQuestion = phase === "setup" ? null : { id: "host-question-1", text: "Private game question 1?" };
  state.gamePlayerIds = ["p1"];
  state.eligiblePlayerIds = ["p1"];
  state.phaseEndsAt = phase === "question" ? 55_000 : null;
  state.answers = phase === "setup" ? {} : {
    p1: { playerId: "p1", rawAnswer: "Player-secret-guess", normalizedAnswer: "player-secret-guess", submittedAt: 20, phaseVersion: 4 },
  };
  state.players.p1.currentAnswerStatus = phase === "setup" ? "not_submitted" : "submitted";
  if (phase === "reveal") {
    state.roundResults = [{
      roundNumber: 1,
      questionId: "host-question-1",
      hostAnswer: "Saffron-code",
      revealedAnswers: [{ playerId: "p1", nickname: "Alex", answer: "Player-secret-guess", matched: false, pointsAwarded: 0 }],
      scoredAt: 30,
      scoredPhaseVersion: 4,
    }];
  }
  return state;
}

describe("role-aware room snapshot privacy", () => {
  it("gives only the authenticated host their setup drafts", () => {
    const state = stateWithSecrets("setup");
    const playerSnapshot = toClientSnapshot(state, 1_000, "p1");
    const hostSnapshot = toClientSnapshot(state, 1_000, "host");
    expect(JSON.stringify(playerSnapshot)).not.toContain("Saffron-code");
    expect(JSON.stringify(playerSnapshot)).not.toContain("Future-secret");
    expect(JSON.stringify(playerSnapshot)).not.toContain("secret-alias");
    expect(hostSnapshot.phase === "setup" && "hostSetup" in hostSnapshot && hostSnapshot.hostSetup.questions).toHaveLength(5);
    expect(hostSnapshot.phase === "setup" && "hostSetup" in hostSnapshot && hostSnapshot.hostSetup.questions[0].answer).toBe("Saffron-code");
    expect(hostSnapshot.phase === "setup" && "hostSetup" in hostSnapshot && hostSnapshot.hostSetup.questions[0].acceptedAnswers).toEqual(["Current-secret-alias"]);
  });

  it("exposes only submission status, progress, deadline, and the question before reveal", () => {
    const snapshot = toPublicSnapshot(stateWithSecrets(), 1_000);
    expect(snapshot.phase).toBe("question");
    if (snapshot.phase !== "question") throw new Error("wrong phase");
    expect(snapshot.submissionProgress).toEqual({ submittedCount: 1, eligibleCount: 1 });
    expect(snapshot.phaseEndsAt).toBe(55_000);
    expect(snapshot.serverNow).toBe(1_000);
    expect(snapshot.players.find((player) => player.playerId === "p1")?.answerStatus).toBe("submitted");
  });

  it("never serializes host answers, future answers, player guesses, or credentials to players before reveal", () => {
    const serialized = JSON.stringify(toClientSnapshot(stateWithSecrets(), 1_000, "p1"));
    for (const forbidden of [
      "Saffron-code",
      "saffron-code",
      "Future-secret",
      "future-secret",
      "Current-secret-alias",
      "current-secret-alias",
      "Future-alias",
      "future-alias",
      "Player-secret-guess",
      "player-secret-guess",
      "rawAnswer",
      "normalizedAnswer",
      "reconnectToken",
      "reconnectTokenHash",
      "host-token-hash",
      "player-token-hash",
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("returns only the current locked answer to the authenticated host during a round", () => {
    const serialized = JSON.stringify(toClientSnapshot(stateWithSecrets(), 1_000, "host"));
    expect(serialized).toContain("Saffron-code");
    expect(serialized).not.toContain("Future-secret");
    expect(serialized).not.toContain("secret-alias");
    expect(serialized).not.toContain("Future-alias");
    expect(serialized).not.toContain("Player-secret-guess");
  });

  it("reveals the current host answer and guesses together without future answers", () => {
    const serialized = JSON.stringify(toPublicSnapshot(stateWithSecrets("reveal"), 1_000));
    expect(serialized).toContain("Saffron-code");
    expect(serialized).toContain("Player-secret-guess");
    expect(serialized).not.toContain("Future-secret");
    expect(serialized).not.toContain("secret-alias");
    expect(serialized).not.toContain("Future-alias");
    expect(serialized).not.toContain("normalizedAnswer");
    expect(serialized).not.toContain("reconnectTokenHash");
  });
});
