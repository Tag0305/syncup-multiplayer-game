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
  normalizedGroup: string | null;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  rank: number;
  score: number;
  roundPoints: number;
  presence: Presence;
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
  schemaVersion: 2;
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
  gamePlayerIds: string[];
  eligiblePlayerIds: string[];
  players: Record<string, PlayerState>;
  answers: Record<string, AnswerState>;
  roundResults: RoundResult[];
  processedCommands: Record<string, ProcessedCommand>;
  scoredPhaseVersions: number[];
  playAgainCommandIds: string[];
  lastRoundPoints: Record<string, number>;
  scheduledTransition: {
    kind: "answer_deadline" | "reveal_fallback" | "leaderboard_fallback";
    deadline: number;
    phaseVersion: number;
  } | null;
  eventSequence: number;
}

export function buildLeaderboard(state: PrivateRoomState): LeaderboardEntry[] {
  const ordered = state.gamePlayerIds
    .map((playerId) => state.players[playerId])
    .filter((player): player is PlayerState => Boolean(player))
    .sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
  let previousScore: number | null = null;
  let rank = 0;
  return ordered.map((player, index) => {
    if (player.score !== previousScore) rank = index + 1;
    previousScore = player.score;
    return {
      playerId: player.playerId,
      nickname: player.nickname,
      rank,
      score: player.score,
      roundPoints: state.lastRoundPoints[player.playerId] ?? 0,
      presence: player.presence,
    };
  });
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


  if (state.phase === "leaderboard") {
    return {
      ...common,
      phase: "leaderboard",
      phaseEndsAt: state.phaseEndsAt,
      leaderboard: buildLeaderboard(state),
    };
  }

  if (state.phase === "final") {
    const leaderboard = buildLeaderboard(state);
    const winningScore = leaderboard[0]?.score ?? 0;
    return {
      ...common,
      phase: "final",
      phaseEndsAt: null,
      leaderboard,
      winnerPlayerIds: leaderboard.filter((entry) => entry.score === winningScore).map((entry) => entry.playerId),
    };
  }

  return {
    ...common,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
  };
}
