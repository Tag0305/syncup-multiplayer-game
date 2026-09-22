import type { PublicRoomSnapshot } from "../protocol/messages";

export type RoomStatus = "lobby" | "playing" | "finished" | "closed";
export type GamePhase = "lobby" | "question" | "reveal" | "leaderboard" | "final";
export type Presence = "connected" | "reconnecting" | "left";
export type AnswerStatus = "not_submitted" | "submitted" | "timed_out";

export interface PlayerState {
  playerId: string;
  nickname: string;
  normalizedNickname: string;
  reconnectTokenHash: string;
  joinOrder: number;
  role: "host" | "player";
  presence: Presence;
  connectionCount: number;
  joinedAt: number;
  disconnectedAt: number | null;
  score: number;
  roundsAnswered: number;
  matchedRounds: number;
  currentAnswerStatus: AnswerStatus;
}

export interface AnswerState {
  playerId: string;
  rawAnswer: string;
  normalizedAnswer: string;
  submittedAt: number;
  phaseVersion: number;
}

export interface RevealedAnswer {
  playerId: string;
  nickname: string;
  answer: string;
  matchSize: number;
  pointsAwarded: number;
}

export interface RoundResult {
  roundNumber: number;
  questionId: string;
  revealedAnswers: RevealedAnswer[];
  scoredAt: number;
  scoredPhaseVersion: number;
}

export interface ProcessedCommand {
  commandId: string;
  playerId: string;
  processedAt: number;
  result: "accepted" | "rejected";
}

export interface SocketTicketState {
  ticketHash: string;
  playerId: string;
  expiresAt: number;
}

export interface PrivateRoomState {
  schemaVersion: 1;
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  phase: GamePhase;
  hostPlayerId: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  gameNumber: number;
  roundNumber: number;
  totalRounds: 5;
  phaseVersion: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  selectedQuestionIds: string[];
  usedQuestionIds: string[];
  currentQuestion: { id: string; text: string } | null;
  eligiblePlayerIds: string[];
  players: Record<string, PlayerState>;
  answers: Record<string, AnswerState>;
  roundResults: RoundResult[];
  processedCommands: Record<string, ProcessedCommand>;
  scoredPhaseVersions: number[];
  playAgainCommandIds: string[];
  eventSequence: number;
}

/**
 * Security boundary: public snapshots are constructed field-by-field. Never
 * spread private room state into a client payload; `answers`, token hashes,
 * normalized nicknames, and the command ledger must stay server-only.
 */
export function toPublicSnapshot(state: PrivateRoomState, serverNow: number): PublicRoomSnapshot {
  const players = Object.values(state.players)
    .filter((player) => player.presence !== "left")
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      role: player.role,
      presence: player.presence,
      score: player.score,
      answerStatus: state.phase === "question" ? player.currentAnswerStatus : undefined,
    }));

  const common = {
    roomCode: state.roomCode,
    status: state.status,
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    phaseVersion: state.phaseVersion,
    eventSequence: state.eventSequence,
    serverNow,
    hostPlayerId: state.hostPlayerId,
    players,
  } as const;

  if (state.phase === "question") {
    if (!state.currentQuestion || state.phaseEndsAt === null) {
      throw new Error("Question phase requires a question and deadline");
    }
    const submittedCount = state.eligiblePlayerIds.filter(
      (id) => state.players[id]?.currentAnswerStatus === "submitted",
    ).length;
    return {
      ...common,
      phase: "question",
      question: state.currentQuestion,
      phaseEndsAt: state.phaseEndsAt,
      submissionProgress: {
        submittedCount,
        eligibleCount: state.eligiblePlayerIds.length,
      },
    };
  }

  if (state.phase === "reveal") {
    return {
      ...common,
      phase: "reveal",
      question: state.currentQuestion,
      revealedAnswers: state.roundResults.at(-1)?.revealedAnswers ?? [],
      phaseEndsAt: state.phaseEndsAt,
    };
  }

  return {
    ...common,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
  };
}
