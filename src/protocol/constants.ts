export const GAME_CONFIG = {
  minPlayers: 2,
  maxPlayers: 8,
  totalRounds: 5,
  answerDurationMs: 45_000,
  reconnectGraceMs: 30_000,
  maxAnswerLength: 60,
  roomCodeLength: 6,
  roomMaxLifetimeMs: 24 * 60 * 60 * 1_000,
  hostFallbackMs: 15_000,
} as const;

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
