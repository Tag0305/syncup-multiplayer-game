import { z } from "zod";
import type { AnswerStatus, GamePhase, LeaderboardEntry, Presence, RoomStatus, RevealedAnswer } from "../game/room-state";

const commandBase = z.object({
  commandId: z.string().uuid(),
  roomCode: z.string().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/),
  playerId: z.string().uuid(),
  expectedPhaseVersion: z.number().int().nonnegative(),
});

export const clientCommandSchema = z.discriminatedUnion("type", [
  commandBase.extend({ type: z.literal("REQUEST_SNAPSHOT") }),
  commandBase.extend({ type: z.literal("START_GAME") }),
  commandBase.extend({ type: z.literal("SUBMIT_ANSWER"), answer: z.string().min(1).max(60) }),
  commandBase.extend({ type: z.literal("ADVANCE_PHASE") }),
  commandBase.extend({ type: z.literal("PLAY_AGAIN") }),
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
  hostPlayerId: string | null;
  players: PublicPlayer[];
}

export type PublicRoomSnapshot =
  | (PublicSnapshotBase & {
      phase: "question";
      question: { id: string; text: string };
      phaseEndsAt: number;
      submissionProgress: { submittedCount: number; eligibleCount: number };
    })
  | (PublicSnapshotBase & {
      phase: "reveal";
      question: { id: string; text: string } | null;
      phaseEndsAt: number | null;
      revealedAnswers: RevealedAnswer[];
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
    })
  | (PublicSnapshotBase & {
      phase: Exclude<GamePhase, "question" | "reveal" | "leaderboard" | "final">;
      phaseEndsAt: number | null;
    });

export type ServerMessage =
  | { type: "ROOM_SNAPSHOT"; snapshot: PublicRoomSnapshot }
  | { type: "COMMAND_ACCEPTED"; commandId: string; eventSequence: number; duplicate?: boolean }
  | { type: "HOST_CHANGED"; hostPlayerId: string | null; eventSequence: number }
  | { type: "COMMAND_REJECTED"; commandId: string; code: string; message: string }
  | { type: "RESYNC_REQUIRED"; expectedEventSequence: number }
  | { type: "PONG"; serverNow: number; clientNow: number };
