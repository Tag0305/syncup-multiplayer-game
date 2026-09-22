import { GAME_CONFIG, ROOM_CODE_ALPHABET } from "../protocol/constants";

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidRoomCode(value: string): boolean {
  const normalized = normalizeRoomCode(value);
  return (
    normalized.length === GAME_CONFIG.roomCodeLength &&
    [...normalized].every((character) => ROOM_CODE_ALPHABET.includes(character))
  );
}

export function generateRoomCode(randomValues: Uint8Array): string {
  if (randomValues.length < GAME_CONFIG.roomCodeLength) {
    throw new Error("Not enough random bytes to generate a room code");
  }
  return [...randomValues]
    .slice(0, GAME_CONFIG.roomCodeLength)
    .map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length])
    .join("");
}
