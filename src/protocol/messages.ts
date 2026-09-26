import { z } from "zod";
import type { AnswerStatus, GamePhase, LeaderboardEntry, Presence, RevealedAnswer, RoomStatus, SetupStatus } from "../game/room-state";
import { GAME_CONFIG } from "./constants";

const commandBase = z.object({
  commandId: z.string().uuid(),
  roomCode: z.string().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/),
  playerId: z.string().uuid(),
  expectedPhaseVersion: z.number().int().nonnegative(),
});

const setupQuestionSchema = z.object({
  question: z.string().min(1).max(GAME_CONFIG.maxQuestionLength),
  answer: z.string().min(1).max(GAME_CONFIG.maxAnswerLength),
  acceptedAnswers: z.array(z.string().min(1).max(GAME_CONFIG.maxAnswerLength)).max(GAME_CONFIG.maxAcceptedAnswers - 1).default([]),
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  commandBase.extend({ type: z.literal("REQUEST_SNAPSHOT") }),
  commandBase.extend({ type: z.literal("SAVE_SETUP"), questions: z.array(setupQuestionSchema).length(5) }),
  commandBase.extend({ type: z.literal("LOCK_SETUP") }),
  commandBase.extend({ type: z.literal("START_GAME") }),
  commandBase.extend({ type: z.literal("SUBMIT_ANSWER"), answer: z.string().min(1).max(60) }),
  commandBase.extend({ type: z.literal("ADVANCE_PHASE") }),
  commandBase.extend({ type: z.literal("SET_UP_ANOTHER_GAME") }),
  commandBase.extend({ type: z.literal("LEAVE_ROOM") }),
  commandBase.extend({ type: z.literal("PING"), clientNow: z.number() }),
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;

export interface PublicPlayer {
  playerId: string;
  nickname: string;
  role: "host" | "player";
  presence: Presence;
  score: number;
  answerStatus?: AnswerStatus;
}

interface PublicSnapshotBase {
  roomCode: string;
  status: RoomStatus;
  roundNumber: number;
  totalRounds: 5;
  phaseVersion: number;
  eventSequence: number;
  serverNow: number;
  hostPlayerId: string;
  hostName: string;
  setupStatus: SetupStatus;
  players: PublicPlayer[];
}

export type PublicRoomSnapshot =
  | (PublicSnapshotBase & { phase: "setup"; phaseEndsAt: null })
  | (PublicSnapshotBase & { phase: "lobby"; phaseEndsAt: null })
  | (PublicSnapshotBase & {
      phase: "question";
      question: { id: string; text: string };
      phaseEndsAt: number;
      submissionProgress: { submittedCount: number; eligibleCount: number };
    })
  | (PublicSnapshotBase & {
      phase: "reveal";
      question: { id: string; text: string } | null;
      hostAnswer: string;
      revealedAnswers: RevealedAnswer[];
      phaseEndsAt: number | null;
    })
  | (PublicSnapshotBase & {
      phase: "leaderboard";
      phaseEndsAt: number | null;
      leaderboard: LeaderboardEntry[];
    })
  | (PublicSnapshotBase & {
      phase: "final";
      phaseEndsAt: null;
      leaderboard: LeaderboardEntry[];
      winnerPlayerIds: string[];
    });

type PublicQuestionSnapshot = Extract<PublicRoomSnapshot, { phase: "question" }>;
type PublicSetupSnapshot = Extract<PublicRoomSnapshot, { phase: "setup" }>;

export type HostSetupRoomSnapshot = PublicSetupSnapshot & {
  hostSetup: { questions: Array<{ question: string; answer: string; acceptedAnswers: string[] }> };
};

export type HostQuestionRoomSnapshot = PublicQuestionSnapshot & { hostLockedAnswer: string };

export type ClientRoomSnapshot = PublicRoomSnapshot | HostSetupRoomSnapshot | HostQuestionRoomSnapshot;

export type ServerMessage =
  | { type: "ROOM_SNAPSHOT"; snapshot: ClientRoomSnapshot }
  | { type: "COMMAND_ACCEPTED"; commandId: string; eventSequence: number; duplicate?: boolean }
  | { type: "COMMAND_REJECTED"; commandId: string; code: string; message: string }
  | { type: "RESYNC_REQUIRED"; expectedEventSequence: number }
  | { type: "PONG"; serverNow: number; clientNow: number };

export type { GamePhase };
