import { describe, expect, it } from "vitest";
import {
  LobbyError,
  addPlayer,
  createInitialRoomState,
  expireDisconnectedPlayers,
  leavePlayer,
  makePlayer,
  markPlayerConnected,
  markPlayerDisconnected,
  normalizeNickname,
} from "../src/game/lobby";

function player(id: string, nickname: string, joinOrder: number, role: "host" | "player" = "player") {
  return makePlayer({ playerId: id, nickname, reconnectTokenHash: `hash-${id}`, joinOrder, role, now: 1_000 });
}

function room() {
  return createInitialRoomState({ roomId: "room", roomCode: "K7M4PX", creator: player("p1", "Maya", 1, "host"), now: 1_000 });
}

describe("lobby domain", () => {
  it("normalizes nickname case, Unicode, and unnecessary spaces", () => {
    expect(normalizeNickname("  MÁYA   Rao ")).toBe("máya rao");
  });

  it("rejects normalized duplicate nicknames", () => {
    const state = room();
    expect(() => addPlayer(state, player("p2", "  MAYA ", 2), 2_000)).toThrowError(LobbyError);
  });

  it("rejects a ninth active player", () => {
    const state = room();
    for (let index = 2; index <= 8; index += 1) addPlayer(state, player(`p${index}`, `Player ${index}`, index), 2_000 + index);
    expect(() => addPlayer(state, player("p9", "Player 9", 9), 3_000)).toThrowError(/eight players/i);
  });

  it("rejects joining after the lobby", () => {
    const state = room();
    state.status = "playing";
    state.phase = "question";
    expect(() => addPlayer(state, player("p2", "Leo", 2), 2_000)).toThrowError(/already in progress/i);
  });

  it("keeps a disconnected host during the 30-second grace period", () => {
    const state = room();
    markPlayerConnected(state, "p1", 1_100);
    addPlayer(state, player("p2", "Leo", 2), 1_200);
    markPlayerConnected(state, "p2", 1_300);
    markPlayerDisconnected(state, "p1", 2_000);
    const result = expireDisconnectedPlayers(state, 31_999);
    expect(result.changed).toBe(false);
    expect(state.hostPlayerId).toBe("p1");
    expect(state.players.p1.presence).toBe("reconnecting");
  });

  it("transfers host after the grace period to the earliest connected player", () => {
    const state = room();
    markPlayerConnected(state, "p1", 1_100);
    addPlayer(state, player("p2", "Leo", 2), 1_200);
    addPlayer(state, player("p3", "Noah", 3), 1_300);
    markPlayerConnected(state, "p2", 1_400);
    markPlayerConnected(state, "p3", 1_500);
    markPlayerDisconnected(state, "p1", 2_000);
    const result = expireDisconnectedPlayers(state, 32_000);
    expect(result.hostChanged).toBe(true);
    expect(state.hostPlayerId).toBe("p2");
  });

  it("transfers host immediately on explicit leave", () => {
    const state = room();
    addPlayer(state, player("p2", "Leo", 2), 1_200);
    markPlayerConnected(state, "p2", 1_300);
    const result = leavePlayer(state, "p1", 2_000);
    expect(result.hostChanged).toBe(true);
    expect(state.hostPlayerId).toBe("p2");
  });
});
