// @vitest-environment node
import { createTestHarness, type TestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicRoomSnapshot, ServerMessage } from "../src/protocol/messages";
import type { PlayerSession } from "../src/api/session";

interface RoomResponse { roomCode: string; session: PlayerSession; snapshot: PublicRoomSnapshot }

class SocketClient {
  readonly socket: WebSocket;
  private messages: ServerMessage[] = [];
  private listeners: Array<() => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage);
      for (const listener of this.listeners.splice(0)) listener();
    });
  }

  async opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error("WebSocket failed to open")), { once: true });
    });
  }

  send(message: unknown): void { this.socket.send(JSON.stringify(message)); }
  close(): void { this.socket.close(); }

  async next(predicate: (message: ServerMessage) => boolean, timeoutMs = 4_000): Promise<ServerMessage> {
    const existingIndex = this.messages.findIndex(predicate);
    if (existingIndex >= 0) return this.messages.splice(existingIndex, 1)[0];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(100, deadline - Date.now()));
        this.listeners.push(() => { clearTimeout(timer); resolve(); });
      });
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return this.messages.splice(index, 1)[0];
    }
    throw new Error("Timed out waiting for WebSocket message");
  }
}

let harness: TestHarness;
let baseUrl: string;
const openSockets: SocketClient[] = [];

async function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  const response = await harness.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() as T };
}

async function create(nickname: string): Promise<RoomResponse> {
  const response = await post<RoomResponse>("/api/rooms", { nickname });
  expect(response.status).toBe(201);
  return response.data;
}

async function join(roomCode: string, nickname: string) {
  return post<RoomResponse & { error?: string }>(`/api/rooms/${roomCode}/join`, { nickname });
}

async function connect(session: PlayerSession): Promise<SocketClient> {
  const ticketResponse = await post<{ ticket: string }>(`/api/rooms/${session.roomCode}/socket-ticket`, {
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
  });
  expect(ticketResponse.status).toBe(200);
  const socketBase = baseUrl.replace(/^http/, "ws");
  const client = new SocketClient(`${socketBase}api/rooms/${session.roomCode}/socket?ticket=${encodeURIComponent(ticketResponse.data.ticket)}`);
  openSockets.push(client);
  await client.opened();
  await client.next((message) => message.type === "ROOM_SNAPSHOT");
  return client;
}

function command(session: PlayerSession, type: "REQUEST_SNAPSHOT" | "LEAVE_ROOM" | "START_GAME" | "SUBMIT_ANSWER" | "ADVANCE_PHASE" | "PLAY_AGAIN", commandId = crypto.randomUUID(), phaseVersion = 0, extra: Record<string, unknown> = {}) {
  return { type, commandId, roomCode: session.roomCode, playerId: session.playerId, expectedPhaseVersion: phaseVersion, ...extra };
}

beforeAll(async () => {
  harness = createTestHarness({ workers: [{ configPath: "./wrangler.jsonc", prebuiltWorkerDir: "./dist-worker" }] });
  const listening = await harness.listen();
  baseUrl = listening.url.toString();
}, 30_000);

afterAll(async () => {
  for (const client of openSockets) client.close();
  await harness.close();
});

describe("real multiplayer lobby", () => {
  it("creates an authoritative room with a six-character host session", async () => {
    const room = await create("Maya");
    expect(room.roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(room.session.reconnectToken.length).toBeGreaterThanOrEqual(32);
    expect(room.snapshot.hostPlayerId).toBe(room.session.playerId);
    expect(room.snapshot.players[0].nickname).toBe("Maya");
  });

  it("joins a room and rejects normalized duplicate names", async () => {
    const room = await create("Maya");
    const joined = await join(room.roomCode, "Leo");
    expect(joined.status).toBe(201);
    expect(joined.data.snapshot.players).toHaveLength(2);
    const duplicate = await join(room.roomCode, "  MAYA  ");
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.error).toBe("DUPLICATE_NICKNAME");
  });

  it("rejects invalid and nonexistent room codes", async () => {
    expect((await join("O1BAD!", "Maya")).status).toBe(400);
    const missing = await join("ZZZZZZ", "Maya");
    expect(missing.status).toBe(404);
    expect(missing.data.error).toBe("ROOM_NOT_FOUND");
  });

  it("rejects a ninth player when the room is full", async () => {
    const room = await create("Player 1");
    for (let index = 2; index <= 8; index += 1) expect((await join(room.roomCode, `Player ${index}`)).status).toBe(201);
    const full = await join(room.roomCode, "Player 9");
    expect(full.status).toBe(409);
    expect(full.data.error).toBe("ROOM_FULL");
  });

  it("synchronizes two independent WebSocket clients in real time", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const hostJoinUpdate = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2);
    expect(hostJoinUpdate.type === "ROOM_SNAPSHOT" && hostJoinUpdate.snapshot.players.some((player) => player.nickname === "Leo")).toBe(true);
    const guest = await connect(joined.data.session);
    const connectedUpdate = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    expect(connectedUpdate.type === "ROOM_SNAPSHOT" && connectedUpdate.snapshot.eventSequence).toBeGreaterThan(room.snapshot.eventSequence);
    guest.close();
  });

  it("marks a temporary disconnect and reconnects with the same refresh credentials", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    guest.close();
    const reconnecting = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === joined.data.session.playerId && player.presence === "reconnecting"));
    expect(reconnecting.type).toBe("ROOM_SNAPSHOT");
    const refreshedGuest = await connect(joined.data.session);
    const restored = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === joined.data.session.playerId && player.presence === "connected"));
    expect(restored.type).toBe("ROOM_SNAPSHOT");
    refreshedGuest.close();
  });

  it("removes a player permanently after explicit leave", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    guest.send(command(joined.data.session, "LEAVE_ROOM"));
    const update = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 1);
    expect(update.type === "ROOM_SNAPSHOT" && update.snapshot.players[0].nickname).toBe("Maya");
  });

  it("transfers host immediately when the host explicitly leaves", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    host.send(command(room.session, "LEAVE_ROOM"));
    const changed = await guest.next((message) => message.type === "HOST_CHANGED");
    expect(changed.type === "HOST_CHANGED" && changed.hostPlayerId).toBe(joined.data.session.playerId);
  });

  it("deduplicates command IDs and rejects stale phase versions", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const commandId = crypto.randomUUID();
    const request = command(room.session, "REQUEST_SNAPSHOT", commandId);
    host.send(request);
    const first = await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === commandId);
    expect(first.type === "COMMAND_ACCEPTED" && first.duplicate).not.toBe(true);
    host.send(request);
    const duplicate = await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === commandId);
    expect(duplicate.type === "COMMAND_ACCEPTED" && duplicate.duplicate).toBe(true);

    const staleId = crypto.randomUUID();
    host.send(command(room.session, "REQUEST_SNAPSHOT", staleId, 99));
    const stale = await host.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === staleId);
    expect(stale.type === "COMMAND_REJECTED" && stale.code).toBe("STALE_PHASE");
  });

  it("keeps rooms isolated", async () => {
    const first = await create("Maya");
    const second = await create("Noah");
    await join(first.roomCode, "Leo");
    const secondSnapshot = await post<{ snapshot: PublicRoomSnapshot }>(`/api/rooms/${second.roomCode}/snapshot`, {
      playerId: second.session.playerId,
      reconnectToken: second.session.reconnectToken,
    });
    expect(secondSnapshot.data.snapshot.players.map((player) => player.nickname)).toEqual(["Noah"]);
  });
});

describe("authoritative multiplayer game", () => {
  it("enforces host-only start, minimum players, and rejects late joins", async () => {
    const soloRoom = await create("Solo");
    const soloHost = await connect(soloRoom.session);
    const soloStartId = crypto.randomUUID();
    soloHost.send(command(soloRoom.session, "START_GAME", soloStartId, soloRoom.snapshot.phaseVersion));
    const minimum = await soloHost.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === soloStartId);
    expect(minimum.type === "COMMAND_REJECTED" && minimum.code).toBe("NOT_ENOUGH_PLAYERS");

    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    const lobby = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (lobby.type !== "ROOM_SNAPSHOT") throw new Error("Expected lobby snapshot");

    const guestStartId = crypto.randomUUID();
    guest.send(command(joined.data.session, "START_GAME", guestStartId, lobby.snapshot.phaseVersion));
    const denied = await guest.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === guestStartId);
    expect(denied.type === "COMMAND_REJECTED" && denied.code).toBe("HOST_ONLY");

    const startId = crypto.randomUUID();
    host.send(command(room.session, "START_GAME", startId, lobby.snapshot.phaseVersion));
    const started = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    expect(started.type === "ROOM_SNAPSHOT" && started.snapshot.roundNumber).toBe(1);
    const late = await join(room.roomCode, "Late Player");
    expect(late.status).toBe(409);
    expect(late.data.error).toBe("GAME_ALREADY_STARTED");
  });

  it("keeps answers private, reveals simultaneously, scores on the server, and deduplicates submissions", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    const lobby = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (lobby.type !== "ROOM_SNAPSHOT") throw new Error("Expected lobby snapshot");
    host.send(command(room.session, "START_GAME", crypto.randomUUID(), lobby.snapshot.phaseVersion));
    const question = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    if (question.type !== "ROOM_SNAPSHOT" || question.snapshot.phase !== "question") throw new Error("Expected question snapshot");

    const answerId = crypto.randomUUID();
    host.send(command(room.session, "SUBMIT_ANSWER", answerId, question.snapshot.phaseVersion, { answer: " Check phone! " }));
    const progress = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.submissionProgress.submittedCount === 1);
    expect(JSON.stringify(progress)).not.toContain("Check phone");
    host.send(command(room.session, "SUBMIT_ANSWER", answerId, question.snapshot.phaseVersion, { answer: "Different" }));
    const duplicate = await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === answerId && message.duplicate === true);
    expect(duplicate.type).toBe("COMMAND_ACCEPTED");

    guest.send(command(joined.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), question.snapshot.phaseVersion, { answer: "check phone" }));
    const reveal = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal");
    if (reveal.type !== "ROOM_SNAPSHOT" || reveal.snapshot.phase !== "reveal") throw new Error("Expected reveal snapshot");
    expect(reveal.snapshot.revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([100, 100]);
    expect(reveal.snapshot.players.map((player) => player.score)).toEqual([100, 100]);
  });

  it("restores the same current-game snapshot after a temporary disconnect", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    const lobby = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (lobby.type !== "ROOM_SNAPSHOT") throw new Error("Expected lobby snapshot");
    host.send(command(room.session, "START_GAME", crypto.randomUUID(), lobby.snapshot.phaseVersion));
    const question = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    if (question.type !== "ROOM_SNAPSHOT" || question.snapshot.phase !== "question") throw new Error("Expected question snapshot");
    const questionId = question.snapshot.question.id;
    guest.close();
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === joined.data.session.playerId && player.presence === "reconnecting"));
    const restoredGuest = await connect(joined.data.session);
    restoredGuest.send(command(joined.data.session, "REQUEST_SNAPSHOT", crypto.randomUUID(), question.snapshot.phaseVersion));
    const restored = await restoredGuest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    expect(restored.type === "ROOM_SNAPSHOT" && restored.snapshot.phase === "question" && restored.snapshot.question.id).toBe(questionId);
  });

  it("completes five synchronized rounds and makes Play Again idempotent", async () => {
    const room = await create("Maya");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Leo");
    const guest = await connect(joined.data.session);
    const lobby = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (lobby.type !== "ROOM_SNAPSHOT") throw new Error("Expected lobby snapshot");
    host.send(command(room.session, "START_GAME", crypto.randomUUID(), lobby.snapshot.phaseVersion));
    let questionMessage = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");

    for (let round = 1; round <= 5; round += 1) {
      if (questionMessage.type !== "ROOM_SNAPSHOT" || questionMessage.snapshot.phase !== "question") throw new Error("Expected question snapshot");
      expect(questionMessage.snapshot.roundNumber).toBe(round);
      const version = questionMessage.snapshot.phaseVersion;
      host.send(command(room.session, "SUBMIT_ANSWER", crypto.randomUUID(), version, { answer: "Same answer" }));
      guest.send(command(joined.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), version, { answer: "same answer!" }));
      const reveal = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal" && message.snapshot.roundNumber === round);
      if (reveal.type !== "ROOM_SNAPSHOT" || reveal.snapshot.phase !== "reveal") throw new Error("Expected reveal snapshot");
      host.send(command(room.session, "ADVANCE_PHASE", crypto.randomUUID(), reveal.snapshot.phaseVersion));
      const leaderboard = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "leaderboard" && message.snapshot.roundNumber === round);
      if (leaderboard.type !== "ROOM_SNAPSHOT" || leaderboard.snapshot.phase !== "leaderboard") throw new Error("Expected leaderboard snapshot");
      host.send(command(room.session, "ADVANCE_PHASE", crypto.randomUUID(), leaderboard.snapshot.phaseVersion));
      if (round < 5) {
        questionMessage = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.roundNumber === round + 1);
      } else {
        const final = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "final");
        if (final.type !== "ROOM_SNAPSHOT" || final.snapshot.phase !== "final") throw new Error("Expected final snapshot");
        expect(final.snapshot.winnerPlayerIds).toHaveLength(2);
        expect(final.snapshot.leaderboard.map((entry) => entry.score)).toEqual([500, 500]);
        const replayId = crypto.randomUUID();
        host.send(command(room.session, "PLAY_AGAIN", replayId, final.snapshot.phaseVersion));
        const replay = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.roundNumber === 1);
        if (replay.type !== "ROOM_SNAPSHOT") throw new Error("Expected replay snapshot");
        host.send(command(room.session, "PLAY_AGAIN", replayId, final.snapshot.phaseVersion));
        const duplicate = await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === replayId && message.duplicate === true);
        expect(duplicate.type).toBe("COMMAND_ACCEPTED");
      }
    }
  });
});
