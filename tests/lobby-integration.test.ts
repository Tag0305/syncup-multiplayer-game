// @vitest-environment node
import { createTestHarness, type TestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerSession } from "../src/api/session";
import type { ClientCommand, ClientRoomSnapshot, ServerMessage } from "../src/protocol/messages";

interface RoomResponse { roomCode: string; session: PlayerSession; snapshot: ClientRoomSnapshot }

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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await harness.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const text = await response.text();
    if (attempt === 0 && text.startsWith("Error: Network connection lost")) continue;
    try {
      return { status: response.status, data: JSON.parse(text) as T };
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text}`);
    }
  }
  throw new Error(`Test harness could not reach ${path}`);
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

type CommandType = ClientCommand["type"];
function command(session: PlayerSession, type: CommandType, commandId = crypto.randomUUID(), phaseVersion = 0, extra: Record<string, unknown> = {}) {
  return { type, commandId, roomCode: session.roomCode, playerId: session.playerId, expectedPhaseVersion: phaseVersion, ...extra };
}

function setupPairs() {
  return Array.from({ length: 5 }, (_, index) => ({ question: `Host question ${index + 1}?`, answer: `Locked answer ${index + 1}` }));
}

async function setupAndLock(host: SocketClient, session: PlayerSession, phaseVersion: number, questions = setupPairs()) {
  host.send(command(session, "SAVE_SETUP", crypto.randomUUID(), phaseVersion, { questions }));
  const saved = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.phaseVersion > phaseVersion);
  if (saved.type !== "ROOM_SNAPSHOT" || saved.snapshot.phase !== "setup") throw new Error("Expected saved setup snapshot");
  host.send(command(session, "LOCK_SETUP", crypto.randomUUID(), saved.snapshot.phaseVersion));
  const locked = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "lobby");
  if (locked.type !== "ROOM_SNAPSHOT" || locked.snapshot.phase !== "lobby") throw new Error("Expected locked lobby snapshot");
  return locked.snapshot;
}

async function start(host: SocketClient, session: PlayerSession, phaseVersion: number) {
  host.send(command(session, "START_GAME", crypto.randomUUID(), phaseVersion));
  const started = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
  if (started.type !== "ROOM_SNAPSHOT" || started.snapshot.phase !== "question") throw new Error("Expected question snapshot");
  return started.snapshot;
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

describe("real multiplayer room and reconnect behavior", () => {
  it("creates an authoritative setup room with a six-character host session", async () => {
    const room = await create("Tagore");
    expect(room.roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    expect(room.session.reconnectToken.length).toBeGreaterThanOrEqual(32);
    expect(room.snapshot).toMatchObject({ phase: "setup", hostPlayerId: room.session.playerId, hostName: "Tagore", setupStatus: "editing" });
    expect(room.snapshot.players[0]).toMatchObject({ nickname: "Tagore", role: "host" });
    expect("hostSetup" in room.snapshot && room.snapshot.hostSetup.questions).toEqual([]);
  });

  it("joins during setup and rejects duplicate names, invalid codes, and full rooms", async () => {
    const room = await create("Tagore");
    const joined = await join(room.roomCode, "Alex");
    expect(joined.status).toBe(201);
    expect(joined.data.snapshot.players).toHaveLength(2);
    expect("hostSetup" in joined.data.snapshot).toBe(false);
    const duplicate = await join(room.roomCode, "  TAGORE  ");
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.error).toBe("DUPLICATE_NICKNAME");
    expect((await join("O1BAD!", "Maya")).status).toBe(400);
    expect((await join("ZZZZZZ", "Maya")).data.error).toBe("ROOM_NOT_FOUND");

    const fullRoom = await create("Host");
    for (let index = 1; index <= 7; index += 1) expect((await join(fullRoom.roomCode, `Player ${index}`)).status).toBe(201);
    const full = await join(fullRoom.roomCode, "Player 8");
    expect(full.status).toBe(409);
    expect(full.data.error).toBe("ROOM_FULL");
  });

  it("synchronizes independent clients and survives repeated guest reconnects without duplicates", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    let guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 2 && message.snapshot.players.every((player) => player.presence === "connected"));

    for (let cycle = 0; cycle < 3; cycle += 1) {
      guest.close();
      await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === joined.data.session.playerId && player.presence === "reconnecting"));
      guest = await connect(joined.data.session);
      const restored = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === joined.data.session.playerId && player.presence === "connected"));
      if (restored.type !== "ROOM_SNAPSHOT") throw new Error("Expected restored snapshot");
      expect(restored.snapshot.players).toHaveLength(2);
      expect(restored.snapshot.players.filter((player) => player.playerId === joined.data.session.playerId)).toHaveLength(1);
    }
  });

  it("restores the original host session before start and never promotes a player", async () => {
    const room = await create("Tagore");
    let host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    host.close();
    const reconnecting = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === room.session.playerId && player.presence === "reconnecting"));
    if (reconnecting.type !== "ROOM_SNAPSHOT") throw new Error("Expected reconnecting snapshot");
    expect(reconnecting.snapshot.hostPlayerId).toBe(room.session.playerId);
    expect(reconnecting.snapshot.players.find((player) => player.playerId === joined.data.session.playerId)?.role).toBe("player");
    host = await connect(room.session);
    const restored = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === room.session.playerId && player.presence === "connected"));
    expect(restored.type === "ROOM_SNAPSHOT" && restored.snapshot.hostPlayerId).toBe(room.session.playerId);
    host.close();
  });

  it("removes explicit leavers and keeps original host identity without transfer", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.every((player) => player.presence === "connected"));
    host.send(command(room.session, "LEAVE_ROOM", crypto.randomUUID(), room.snapshot.phaseVersion));
    const update = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.length === 1);
    if (update.type !== "ROOM_SNAPSHOT") throw new Error("Expected leave snapshot");
    expect(update.snapshot.hostPlayerId).toBe(room.session.playerId);
    expect(update.snapshot.players[0]).toMatchObject({ playerId: joined.data.session.playerId, role: "player" });
  });

  it("deduplicates command IDs, rejects stale phase versions, and isolates rooms", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const commandId = crypto.randomUUID();
    const request = command(room.session, "REQUEST_SNAPSHOT", commandId, room.snapshot.phaseVersion);
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

    const second = await create("Second Host");
    const secondSnapshot = await post<{ snapshot: ClientRoomSnapshot }>(`/api/rooms/${second.roomCode}/snapshot`, {
      playerId: second.session.playerId,
      reconnectToken: second.session.reconnectToken,
    });
    expect(secondSnapshot.data.snapshot.players.map((player) => player.nickname)).toEqual(["Second Host"]);
  });
});

describe("authoritative host-answer game", () => {
  it("keeps setup secrets host-only and enforces host-only locking", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    const connected = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.every((player) => player.presence === "connected"));
    if (connected.type !== "ROOM_SNAPSHOT" || connected.snapshot.phase !== "setup") throw new Error("Expected setup snapshot");
    const questions = setupPairs();
    host.send(command(room.session, "SAVE_SETUP", crypto.randomUUID(), connected.snapshot.phaseVersion, { questions }));
    const hostSaved = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.phaseVersion > connected.snapshot.phaseVersion);
    if (hostSaved.type !== "ROOM_SNAPSHOT" || hostSaved.snapshot.phase !== "setup") throw new Error("Expected host setup snapshot");
    expect("hostSetup" in hostSaved.snapshot && hostSaved.snapshot.hostSetup.questions[0].answer).toBe("Locked answer 1");
    const playerSaved = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.phaseVersion === hostSaved.snapshot.phaseVersion);
    expect(JSON.stringify(playerSaved)).not.toContain("Locked answer");
    expect(JSON.stringify(playerSaved)).not.toContain("normalizedAnswer");

    const lockId = crypto.randomUUID();
    guest.send(command(joined.data.session, "LOCK_SETUP", lockId, hostSaved.snapshot.phaseVersion));
    const denied = await guest.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === lockId);
    expect(denied.type === "COMMAND_REJECTED" && denied.code).toBe("HOST_ONLY");
  });

  it("cannot start before setup lock or without one connected competitor", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const prematureId = crypto.randomUUID();
    host.send(command(room.session, "START_GAME", prematureId, room.snapshot.phaseVersion));
    const premature = await host.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === prematureId);
    expect(premature.type === "COMMAND_REJECTED" && premature.code).toBe("INVALID_PHASE");
    const lobby = await setupAndLock(host, room.session, room.snapshot.phaseVersion);
    const noPlayersId = crypto.randomUUID();
    host.send(command(room.session, "START_GAME", noPlayersId, lobby.phaseVersion));
    const noPlayers = await host.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === noPlayersId);
    expect(noPlayers.type === "COMMAND_REJECTED" && noPlayers.code).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("allows only the host to start and blocks late joins", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    const setup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(host, room.session, setup.snapshot.phaseVersion);
    const guestStartId = crypto.randomUUID();
    guest.send(command(joined.data.session, "START_GAME", guestStartId, lobby.phaseVersion));
    const denied = await guest.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === guestStartId);
    expect(denied.type === "COMMAND_REJECTED" && denied.code).toBe("HOST_ONLY");
    const question = await start(host, room.session, lobby.phaseVersion);
    expect(question.roundNumber).toBe(1);
    expect(question.question.text).toBe("Host question 1?");
    const late = await join(room.roomCode, "Late Player");
    expect(late.status).toBe(409);
    expect(late.data.error).toBe("GAME_ALREADY_STARTED");
  });

  it("keeps guesses private, reveals against the host answer, scores server-side, and deduplicates submissions", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const firstJoin = await join(room.roomCode, "Alex");
    const first = await connect(firstJoin.data.session);
    const secondJoin = await join(room.roomCode, "Maya");
    const second = await connect(secondJoin.data.session);
    const setup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.length === 3 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(host, room.session, setup.snapshot.phaseVersion);
    const hostQuestion = await start(host, room.session, lobby.phaseVersion);
    expect("hostLockedAnswer" in hostQuestion && hostQuestion.hostLockedAnswer).toBe("Locked answer 1");
    const playerQuestion = await first.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    expect(JSON.stringify(playerQuestion)).not.toContain("Locked answer");

    const answerId = crypto.randomUUID();
    first.send(command(firstJoin.data.session, "SUBMIT_ANSWER", answerId, hostQuestion.phaseVersion, { answer: " locked answer 1! " }));
    const progress = await second.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.submissionProgress.submittedCount === 1);
    expect(JSON.stringify(progress)).not.toContain("locked answer 1!");
    first.send(command(firstJoin.data.session, "SUBMIT_ANSWER", answerId, hostQuestion.phaseVersion, { answer: "Different" }));
    const duplicate = await first.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === answerId && message.duplicate === true);
    expect(duplicate.type).toBe("COMMAND_ACCEPTED");
    second.send(command(secondJoin.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), hostQuestion.phaseVersion, { answer: "Different" }));
    const reveal = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal");
    if (reveal.type !== "ROOM_SNAPSHOT" || reveal.snapshot.phase !== "reveal") throw new Error("Expected reveal snapshot");
    expect(reveal.snapshot.hostAnswer).toBe("Locked answer 1");
    expect(reveal.snapshot.revealedAnswers.map((answer) => answer.pointsAwarded)).toEqual([100, 0]);
    expect(reveal.snapshot.revealedAnswers.map((answer) => answer.matched)).toEqual([true, false]);
    expect(reveal.snapshot.players.find((player) => player.role === "host")?.score).toBe(0);
  });

  it("restores a submitted player state without leaking the guess", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const firstJoin = await join(room.roomCode, "Alex");
    let first = await connect(firstJoin.data.session);
    const secondJoin = await join(room.roomCode, "Maya");
    await connect(secondJoin.data.session);
    const setup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.length === 3 && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(host, room.session, setup.snapshot.phaseVersion);
    const question = await start(host, room.session, lobby.phaseVersion);
    first.send(command(firstJoin.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), question.phaseVersion, { answer: "Private player guess" }));
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.submissionProgress.submittedCount === 1);
    first.close();
    await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.players.some((player) => player.playerId === firstJoin.data.session.playerId && player.presence === "reconnecting"));
    first = await connect(firstJoin.data.session);
    first.send(command(firstJoin.data.session, "REQUEST_SNAPSHOT", crypto.randomUUID(), question.phaseVersion));
    const restored = await first.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.submissionProgress.submittedCount === 1);
    if (restored.type !== "ROOM_SNAPSHOT" || restored.snapshot.phase !== "question") throw new Error("Expected restored question snapshot");
    expect(restored.snapshot.players.find((player) => player.playerId === firstJoin.data.session.playerId)?.answerStatus).toBe("submitted");
    expect(JSON.stringify(restored.snapshot)).not.toContain("Private player guess");
  });

  it("continues an active game from locked server state while the host reconnects", async () => {
    const room = await create("Tagore");
    let host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    const setup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(host, room.session, setup.snapshot.phaseVersion);
    const question = await start(host, room.session, lobby.phaseVersion);
    host.close();
    const reconnecting = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.players.some((player) => player.playerId === room.session.playerId && player.presence === "reconnecting"));
    expect(JSON.stringify(reconnecting)).not.toContain("Locked answer");
    guest.send(command(joined.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), question.phaseVersion, { answer: "Locked answer 1" }));
    const reveal = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal");
    if (reveal.type !== "ROOM_SNAPSHOT" || reveal.snapshot.phase !== "reveal") throw new Error("Expected reveal snapshot");
    expect(reveal.snapshot.revealedAnswers[0]).toMatchObject({ matched: true, pointsAwarded: 100 });
    host = await connect(room.session);
    host.send(command(room.session, "REQUEST_SNAPSHOT", crypto.randomUUID(), reveal.snapshot.phaseVersion));
    const restored = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal");
    expect(restored.type).toBe("ROOM_SNAPSHOT");
  });

  it("rejects a stale parallel socket without overwriting newer game state", async () => {
    const room = await create("Tagore");
    const originalHost = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    const setup = await originalHost.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(originalHost, room.session, setup.snapshot.phaseVersion);
    const refreshedHost = await connect(room.session);
    const question = await start(refreshedHost, room.session, lobby.phaseVersion);
    const staleId = crypto.randomUUID();
    originalHost.send(command(room.session, "START_GAME", staleId, lobby.phaseVersion));
    const rejected = await originalHost.next((message) => message.type === "COMMAND_REJECTED" && message.commandId === staleId);
    expect(rejected.type === "COMMAND_REJECTED" && rejected.code).toBe("STALE_PHASE");
    guest.send(command(joined.data.session, "REQUEST_SNAPSHOT", crypto.randomUUID(), question.phaseVersion));
    const current = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question");
    expect(current.type === "ROOM_SNAPSHOT" && current.snapshot.phase).toBe("question");
  });

  it("completes five ordered rounds and idempotently returns to blank setup", async () => {
    const room = await create("Tagore");
    const host = await connect(room.session);
    const joined = await join(room.roomCode, "Alex");
    const guest = await connect(joined.data.session);
    const setup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.players.every((player) => player.presence === "connected"));
    if (setup.type !== "ROOM_SNAPSHOT") throw new Error("Expected setup snapshot");
    const lobby = await setupAndLock(host, room.session, setup.snapshot.phaseVersion);
    let question = await start(host, room.session, lobby.phaseVersion);

    for (let round = 1; round <= 5; round += 1) {
      expect(question.roundNumber).toBe(round);
      expect(question.question.text).toBe(`Host question ${round}?`);
      guest.send(command(joined.data.session, "SUBMIT_ANSWER", crypto.randomUUID(), question.phaseVersion, { answer: `locked answer ${round}!` }));
      const reveal = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "reveal" && message.snapshot.roundNumber === round);
      if (reveal.type !== "ROOM_SNAPSHOT" || reveal.snapshot.phase !== "reveal") throw new Error("Expected reveal snapshot");
      host.send(command(room.session, "ADVANCE_PHASE", crypto.randomUUID(), reveal.snapshot.phaseVersion));
      const leaderboard = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "leaderboard" && message.snapshot.roundNumber === round);
      if (leaderboard.type !== "ROOM_SNAPSHOT" || leaderboard.snapshot.phase !== "leaderboard") throw new Error("Expected leaderboard snapshot");
      expect(leaderboard.snapshot.leaderboard).toHaveLength(1);
      expect(leaderboard.snapshot.leaderboard[0].playerId).toBe(joined.data.session.playerId);
      expect(leaderboard.snapshot.leaderboard[0].score).toBe(round * 100);
      host.send(command(room.session, "ADVANCE_PHASE", crypto.randomUUID(), leaderboard.snapshot.phaseVersion));
      if (round < 5) {
        const next = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "question" && message.snapshot.roundNumber === round + 1);
        if (next.type !== "ROOM_SNAPSHOT" || next.snapshot.phase !== "question") throw new Error("Expected next question");
        question = next.snapshot;
      } else {
        const final = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "final");
        if (final.type !== "ROOM_SNAPSHOT" || final.snapshot.phase !== "final") throw new Error("Expected final snapshot");
        expect(final.snapshot.leaderboard).toHaveLength(1);
        expect(final.snapshot.leaderboard[0].score).toBe(500);
        expect(final.snapshot.winnerPlayerIds).toEqual([joined.data.session.playerId]);

        const newGameId = crypto.randomUUID();
        host.send(command(room.session, "SET_UP_ANOTHER_GAME", newGameId, final.snapshot.phaseVersion));
        await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === newGameId);
        const freshSetup = await host.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.phaseVersion > final.snapshot.phaseVersion);
        if (freshSetup.type !== "ROOM_SNAPSHOT" || freshSetup.snapshot.phase !== "setup") throw new Error("Expected fresh setup");
        expect(freshSetup.snapshot.setupStatus).toBe("editing");
        expect("hostSetup" in freshSetup.snapshot && freshSetup.snapshot.hostSetup.questions).toEqual([]);
        expect(freshSetup.snapshot.players.find((player) => player.role === "player")?.score).toBe(0);
        const playerFreshSetup = await guest.next((message) => message.type === "ROOM_SNAPSHOT" && message.snapshot.phase === "setup" && message.snapshot.phaseVersion === freshSetup.snapshot.phaseVersion);
        expect("hostSetup" in (playerFreshSetup.type === "ROOM_SNAPSHOT" ? playerFreshSetup.snapshot : {})).toBe(false);
        expect(JSON.stringify(playerFreshSetup)).not.toContain("Locked answer");

        host.send(command(room.session, "SET_UP_ANOTHER_GAME", newGameId, final.snapshot.phaseVersion));
        const duplicate = await host.next((message) => message.type === "COMMAND_ACCEPTED" && message.commandId === newGameId && message.duplicate === true);
        expect(duplicate.type).toBe("COMMAND_ACCEPTED");
      }
    }
  });
});
