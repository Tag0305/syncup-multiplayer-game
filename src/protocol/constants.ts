export const GAME_CONFIG = {
  minCompetitors: 1,
  maxPlayers: 8,
  totalRounds: 5,
  answerDurationMs: 45_000,
  reconnectGraceMs: 30_000,
  maxAnswerLength: 60,
  maxAcceptedAnswers: 5,
  maxQuestionLength: 140,
  roomCodeLength: 6,
  roomMaxLifetimeMs: 24 * 60 * 60 * 1_000,
  revealDurationMs: 8_000,
  hostFallbackMs: 15_000,
} as const;

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
