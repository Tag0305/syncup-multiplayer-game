import { describe, expect, it } from "vitest";
import { toPublicSnapshot, type PrivateRoomState } from "../src/game/room-state";

function questionState(): PrivateRoomState {
  return {
    schemaVersion: 2, roomId: "room-id", roomCode: "K7M4PX", status: "playing", phase: "question",
    hostPlayerId: "p1", createdAt: 1, updatedAt: 2, expiresAt: 99, gameNumber: 1, roundNumber: 1,
    totalRounds: 5, phaseVersion: 4, phaseStartedAt: 10, phaseEndsAt: 55_000,
    selectedQuestionIds: ["q1"], usedQuestionIds: ["q1"], currentQuestion: { id: "q1", text: "A question?" },
    gamePlayerIds: ["p1", "p2"], eligiblePlayerIds: ["p1", "p2"],
    players: {
      p1: { playerId:"p1",nickname:"Maya",normalizedNickname:"maya",reconnectTokenHash:"secret-hash",joinOrder:1,role:"host",presence:"connected",connectionCount:1,joinedAt:1,disconnectedAt:null,score:0,roundsAnswered:1,matchedRounds:0,currentAnswerStatus:"submitted" },
      p2: { playerId:"p2",nickname:"Leo",normalizedNickname:"leo",reconnectTokenHash:"other-secret",joinOrder:2,role:"player",presence:"connected",connectionCount:1,joinedAt:2,disconnectedAt:null,score:0,roundsAnswered:0,matchedRounds:0,currentAnswerStatus:"not_submitted" },
    },
    answers: { p1: { playerId:"p1",rawAnswer:"  CRYPTO! ",normalizedAnswer:"crypto",submittedAt:20,phaseVersion:4 } },
    roundResults: [], processedCommands: {}, scoredPhaseVersions: [], playAgainCommandIds: [], lastRoundPoints: {},
    scheduledTransition: { kind: "answer_deadline", deadline: 55_000, phaseVersion: 4 }, eventSequence: 8,
  };
}

describe("public answering state", () => {
  it("contains progress and the authoritative deadline", () => {
    const snapshot = toPublicSnapshot(questionState(), 1_000);
    expect(snapshot.phase).toBe("question");
    if (snapshot.phase !== "question") throw new Error("wrong phase");
    expect(snapshot.submissionProgress).toEqual({ submittedCount: 1, eligibleCount: 2 });
    expect(snapshot.phaseEndsAt).toBe(55_000);
    expect(snapshot.serverNow).toBe(1_000);
  });

  it("never serializes private answers, normalized nicknames, or token hashes", () => {
    const serialized = JSON.stringify(toPublicSnapshot(questionState(), 1_000));
    expect(serialized).not.toContain("CRYPTO");
    expect(serialized).not.toContain("crypto");
    expect(serialized).not.toContain("rawAnswer");
    expect(serialized).not.toContain("normalizedAnswer");
    expect(serialized).not.toContain("reconnectTokenHash");
    expect(serialized).not.toContain("secret-hash");
  });
});
