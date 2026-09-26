import type { ClientRoomSnapshot, PublicRoomSnapshot } from "../protocol/messages";

export type RoomStatus = "lobby" | "playing" | "finished" | "closed";
export type GamePhase = "setup" | "lobby" | "question" | "reveal" | "leaderboard" | "final";
export type Presence = "connected" | "reconnecting" | "left";
export type AnswerStatus = "not_submitted" | "submitted" | "timed_out";
export type SetupStatus = "editing" | "locked";

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

export interface HostQuestionState {
  id: string;
  question: string;
  primaryAnswer: LockedAnswerState;
  acceptedAlternatives: LockedAnswerState[];
}

export interface LockedAnswerState {
  rawAnswer: string;
  normalizedAnswer: string;
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
  matched: boolean;
  pointsAwarded: number;
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
  hostAnswer: string;
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
  schemaVersion: 4;
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  phase: GamePhase;
  originalHostPlayerId: string;
  hostPlayerId: string;
  setupStatus: SetupStatus;
  hostQuestions: HostQuestionState[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  gameNumber: number;
  roundNumber: number;
  totalRounds: 5;
  phaseVersion: number;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null;
  currentQuestion: { id: string; text: string } | null;
  gamePlayerIds: string[];
  eligiblePlayerIds: string[];
  players: Record<string, PlayerState>;
  answers: Record<string, AnswerState>;
  roundResults: RoundResult[];
  processedCommands: Record<string, ProcessedCommand>;
  scoredPhaseVersions: number[];
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
    .filter((player): player is PlayerState => Boolean(player) && player.role === "player")
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
 * Public security boundary. This serializer deliberately has no viewer input
 * and no path to host answers, player answers, normalized values, reconnect
 * credentials, or command history before the reveal phase.
 */
export function toPublicSnapshot(state: PrivateRoomState, serverNow: number): PublicRoomSnapshot {
  const hostName = state.players[state.originalHostPlayerId]?.nickname ?? "Host";
  const players = Object.values(state.players)
    .filter((player) => player.presence !== "left")
    .sort((a, b) => a.joinOrder - b.joinOrder)
    .map((player) => ({
      playerId: player.playerId,
      nickname: player.nickname,
      role: player.role,
      presence: player.presence,
      score: player.role === "player" ? player.score : 0,
      answerStatus: state.phase === "question" && player.role === "player" ? player.currentAnswerStatus : undefined,
    }));

  const common = {
    roomCode: state.roomCode,
    status: state.status,
    roundNumber: state.roundNumber,
    totalRounds: state.totalRounds,
    phaseVersion: state.phaseVersion,
    eventSequence: state.eventSequence,
    serverNow,
    hostPlayerId: state.originalHostPlayerId,
    hostName,
    setupStatus: state.setupStatus,
    players,
  } as const;

  if (state.phase === "setup") return { ...common, phase: "setup", phaseEndsAt: null };
  if (state.phase === "lobby") return { ...common, phase: "lobby", phaseEndsAt: null };

  if (state.phase === "question") {
    if (!state.currentQuestion || state.phaseEndsAt === null) throw new Error("Question phase requires a question and deadline");
    const requiredIds = state.eligiblePlayerIds.filter((id) => state.players[id]?.presence !== "left");
    return {
      ...common,
      phase: "question",
      question: state.currentQuestion,
      phaseEndsAt: state.phaseEndsAt,
      submissionProgress: {
        submittedCount: requiredIds.filter((id) => state.players[id]?.currentAnswerStatus === "submitted").length,
        eligibleCount: requiredIds.length,
      },
    };
  }

  if (state.phase === "reveal") {
    const result = state.roundResults.at(-1);
    return {
      ...common,
      phase: "reveal",
      question: state.currentQuestion,
      hostAnswer: result?.hostAnswer ?? "",
      revealedAnswers: result?.revealedAnswers ?? [],
      phaseEndsAt: state.phaseEndsAt,
    };
  }

  if (state.phase === "leaderboard") {
    return { ...common, phase: "leaderboard", phaseEndsAt: state.phaseEndsAt, leaderboard: buildLeaderboard(state) };
  }

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

/** Adds private host-only fields after authentication. Never use this result for another socket. */
export function toClientSnapshot(state: PrivateRoomState, serverNow: number, viewerPlayerId: string): ClientRoomSnapshot {
  const publicSnapshot = toPublicSnapshot(state, serverNow);
  if (viewerPlayerId !== state.originalHostPlayerId) return publicSnapshot;
  if (publicSnapshot.phase === "setup") {
    return {
      ...publicSnapshot,
      hostSetup: {
        questions: state.hostQuestions.map(({ question, primaryAnswer, acceptedAlternatives }) => ({
          question,
          answer: primaryAnswer.rawAnswer,
          acceptedAnswers: acceptedAlternatives.map(({ rawAnswer }) => rawAnswer),
        })),
      },
    };
  }
  if (publicSnapshot.phase === "question") {
    const locked = state.hostQuestions[state.roundNumber - 1];
    return { ...publicSnapshot, hostLockedAnswer: locked?.primaryAnswer.rawAnswer ?? "" };
  }
  return publicSnapshot;
}
