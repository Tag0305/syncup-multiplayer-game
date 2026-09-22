import { describe, expect, it } from "vitest";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "../src/worker/room-code";

describe("room codes", () => {
  it("normalizes and validates an unambiguous six-character code", () => {
    expect(normalizeRoomCode(" k7m4px ")).toBe("K7M4PX");
    expect(isValidRoomCode("K7M4PX")).toBe(true);
  });

  it("rejects ambiguous or incorrectly sized codes", () => {
    expect(isValidRoomCode("O1ABCD")).toBe(false);
    expect(isValidRoomCode("ABC23")).toBe(false);
  });

  it("uses only the allowed alphabet", () => {
    expect(generateRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5]))).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });
});
