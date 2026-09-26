import { GAME_CONFIG } from "../protocol/constants";
import type { PlayerState, PrivateRoomState } from "./room-state";

export type LobbyErrorCode =
  | "INVALID_NICKNAME"
  | "DUPLICATE_NICKNAME"
  | "ROOM_FULL"
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "GAME_ALREADY_STARTED"
  | "INVALID_SESSION";

export class LobbyError extends Error {
  constructor(public readonly code: LobbyErrorCode, message: string) {
    super(message);
    this.name = "LobbyError";
  }
}

export function normalizeNickname(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function cleanNickname(value: string): string {
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 20 || /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(cleaned)) {
    throw new LobbyError("INVALID_NICKNAME", "Nickname must be 2–20 visible characters.");
  }
  return cleaned;
}

export function makePlayer(args: {
  playerId: string;
  nickname: string;
  reconnectTokenHash: string;
  joinOrder: number;
  role: "host" | "player";
  now: number;
}): PlayerState {
  const nickname = cleanNickname(args.nickname);
  return {
    playerId: args.playerId,
    nickname,
    normalizedNickname: normalizeNickname(nickname),
    reconnectTokenHash: args.reconnectTokenHash,
    joinOrder: args.joinOrder,
    role: args.role,
    presence: "connected",
    connectionCount: 0,
    joinedAt: args.now,
    disconnectedAt: null,
    score: 0,
    roundsAnswered: 0,
    matchedRounds: 0,
    currentAnswerStatus: "not_submitted",
  };
}

export function createInitialRoomState(args: {
  roomId: string;
  roomCode: string;
  creator: PlayerState;
  now: number;
}): PrivateRoomState {
  return {
    schemaVersion: 3,
    roomId: args.roomId,
    roomCode: args.roomCode,
    status: "lobby",
    phase: "setup",
    originalHostPlayerId: args.creator.playerId,
    hostPlayerId: args.creator.playerId,
    setupStatus: "editing",
    hostQuestions: [],
    createdAt: args.now,
    updatedAt: args.now,
    expiresAt: args.now + GAME_CONFIG.roomMaxLifetimeMs,
    gameNumber: 0,
    roundNumber: 0,
    totalRounds: 5,
    phaseVersion: 0,
    phaseStartedAt: null,
    phaseEndsAt: null,
    currentQuestion: null,
    gamePlayerIds: [],
    eligiblePlayerIds: [],
    players: { [args.creator.playerId]: args.creator },
    answers: {},
    roundResults: [],
    processedCommands: {},
    scoredPhaseVersions: [],
    lastRoundPoints: {},
    scheduledTransition: null,
    eventSequence: 1,
  };
}

export function assertRoomAvailable(state: PrivateRoomState | undefined, now: number): asserts state is PrivateRoomState {
  if (!state) throw new LobbyError("ROOM_NOT_FOUND", "Room not found or no longer available.");
  if (state.status === "closed" || state.expiresAt <= now) {
    throw new LobbyError("ROOM_EXPIRED", "This room has expired.");
  }
}

export function addPlayer(state: PrivateRoomState, player: PlayerState, now: number): void {
  assertRoomAvailable(state, now);
  if (state.status !== "lobby" || (state.phase !== "setup" && state.phase !== "lobby")) {
    throw new LobbyError("GAME_ALREADY_STARTED", "This game is already in progress.");
  }
  const activePlayers = Object.values(state.players).filter((existing) => existing.presence !== "left");
  if (activePlayers.length >= GAME_CONFIG.maxPlayers) {
    throw new LobbyError("ROOM_FULL", "This room already has eight players.");
  }
  if (activePlayers.some((existing) => existing.normalizedNickname === player.normalizedNickname)) {
    throw new LobbyError("DUPLICATE_NICKNAME", "That nickname is already being used in this room.");
  }
  state.players[player.playerId] = player;
  state.updatedAt = now;
  state.eventSequence += 1;
}

export function markPlayerConnected(state: PrivateRoomState, playerId: string, now: number): boolean {
  const player = state.players[playerId];
  if (!player || player.presence === "left") throw new LobbyError("INVALID_SESSION", "Player session is no longer active.");
  const changed = player.presence !== "connected";
  player.presence = "connected";
  player.connectionCount += 1;
  player.disconnectedAt = null;
  state.updatedAt = now;
  if (changed) state.eventSequence += 1;
  return changed;
}

export function markPlayerDisconnected(state: PrivateRoomState, playerId: string, now: number): boolean {
  const player = state.players[playerId];
  if (!player || player.presence === "left") return false;
  player.connectionCount = Math.max(0, player.connectionCount - 1);
  if (player.connectionCount > 0) return false;
  if (player.presence === "reconnecting") return false;
  player.presence = "reconnecting";
  player.disconnectedAt = now;
  state.updatedAt = now;
  state.eventSequence += 1;
  return true;
}

export function leavePlayer(state: PrivateRoomState, playerId: string, now: number): { hostChanged: false; hostPlayerId: string } {
  const player = state.players[playerId];
  if (!player || player.presence === "left") return { hostChanged: false, hostPlayerId: state.hostPlayerId };
  player.presence = "left";
  player.connectionCount = 0;
  player.disconnectedAt = null;
  state.updatedAt = now;
  state.eventSequence += 1;
  return { hostChanged: false, hostPlayerId: state.hostPlayerId };
}

export function expireDisconnectedPlayers(state: PrivateRoomState, now: number): { changed: boolean; hostChanged: boolean } {
  let changed = false;
  for (const player of Object.values(state.players)) {
    if (
      player.presence === "reconnecting" &&
      player.disconnectedAt !== null &&
      player.disconnectedAt + GAME_CONFIG.reconnectGraceMs <= now
    ) {
      player.presence = "left";
      player.disconnectedAt = null;
      player.connectionCount = 0;
      changed = true;
    }
  }
  if (changed) {
    state.updatedAt = now;
    state.eventSequence += 1;
  }
  return { changed, hostChanged: false };
}

export function nextPresenceDeadline(state: PrivateRoomState): number | null {
  const deadlines = Object.values(state.players)
    .filter((player) => player.presence === "reconnecting" && player.disconnectedAt !== null)
    .map((player) => player.disconnectedAt! + GAME_CONFIG.reconnectGraceMs);
  return deadlines.length ? Math.min(...deadlines) : null;
}

export function recordProcessedCommand(
  state: PrivateRoomState,
  commandId: string,
  playerId: string,
  now: number,
  result: "accepted" | "rejected",
): void {
  state.processedCommands[commandId] = { commandId, playerId, processedAt: now, result };
  const commands = Object.values(state.processedCommands).sort((a, b) => b.processedAt - a.processedAt);
  for (const old of commands.slice(256)) delete state.processedCommands[old.commandId];
}
