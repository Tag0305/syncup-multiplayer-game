import { DurableObject } from "cloudflare:workers";
import {
  LobbyError,
  addPlayer,
  assertRoomAvailable,
  createInitialRoomState,
  expireDisconnectedPlayers,
  leavePlayer,
  makePlayer,
  markPlayerConnected,
  markPlayerDisconnected,
  nextPresenceDeadline,
  recordProcessedCommand,
} from "../game/lobby";
import {
  GameError,
  advancePhase,
  allRequiredAnswersSubmitted,
  handleScheduledTransition,
  lockHostSetup,
  revealAnswers,
  saveHostSetup,
  setUpAnotherGame,
  startGame,
  submitAnswer,
} from "../game/game-engine";
import { toClientSnapshot, type PrivateRoomState, type SocketTicketState } from "../game/room-state";
import { clientCommandSchema, type ClientCommand, type ServerMessage } from "../protocol/messages";
import { createSecret, hashSecret, secretsEqual } from "./security";

interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
  ASSETS: Fetcher;
}

interface ClaimRequest {
  roomCode: string;
  roomId: string;
  creationNonce: string;
  creatorNickname: string;
  now: number;
}

interface StoredClaim {
  roomCode: string;
  roomId: string;
  creationNonce: string;
  claimedAt: number;
}

interface SessionRequest {
  playerId: string;
  reconnectToken: string;
}

const CLAIM_KEY = "room:claim";
const STATE_KEY = "room:state";
const TICKET_PREFIX = "socket-ticket:";
const SOCKET_TICKET_TTL_MS = 15_000;

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: code, message }, { status });
}

function lobbyErrorResponse(error: LobbyError): Response {
  const status = error.code === "ROOM_NOT_FOUND"
    ? 404
    : error.code === "ROOM_EXPIRED"
      ? 410
      : error.code === "INVALID_SESSION"
        ? 401
        : error.code === "INVALID_NICKNAME"
          ? 400
          : 409;
  return jsonError(error.code, error.message, status);
}

function playerTag(playerId: string): string {
  return `player:${playerId}`;
}

function upgradeState(state: PrivateRoomState): PrivateRoomState {
  const candidate = state as unknown as Record<string, unknown>;
  if (candidate.schemaVersion !== 3) {
    const originalHostPlayerId = typeof candidate.hostPlayerId === "string" ? candidate.hostPlayerId : "";
    candidate.schemaVersion = 3;
    candidate.originalHostPlayerId = originalHostPlayerId;
    candidate.hostPlayerId = originalHostPlayerId;
    candidate.setupStatus = "editing";
    candidate.hostQuestions = [];
    candidate.gamePlayerIds ??= [];
    candidate.lastRoundPoints ??= {};
    candidate.scheduledTransition ??= null;
    if (candidate.phase === "lobby") {
      candidate.phase = "setup";
      candidate.status = "lobby";
    } else {
      // Pre-conversion games cannot be reconstructed because they have no
      // locked host-authored answers. Their clients must create a new room.
      candidate.status = "closed";
    }
  }
  return candidate as unknown as PrivateRoomState;
}

export class RoomDurableObject extends DurableObject<Env> {
  private readonly finalizedSockets = new WeakSet<WebSocket>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/internal/claim" && request.method === "POST") return await this.claimRoom(request);
      if (url.pathname === "/internal/join" && request.method === "POST") return await this.joinRoom(request);
      if (url.pathname === "/internal/socket-ticket" && request.method === "POST") return await this.createSocketTicket(request);
      if (url.pathname === "/internal/snapshot" && request.method === "POST") return await this.getAuthenticatedSnapshot(request);
      if (url.pathname === "/socket" && request.headers.get("Upgrade") === "websocket") return await this.acceptWebSocket(url);
      return jsonError("NOT_FOUND", "Route not found.", 404);
    } catch (error) {
      if (error instanceof LobbyError) return lobbyErrorResponse(error);
      console.error("Room request failed", error);
      return jsonError("INTERNAL_ERROR", "The room is temporarily unavailable.", 500);
    }
  }

  async alarm(_alarmInfo?: AlarmInvocationInfo): Promise<void> {
    const now = Date.now();
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    if (!state) return;
    if (state.status === "closed") {
      for (const socket of this.ctx.getWebSockets()) socket.close(4000, "Room closed");
      return;
    }

    if (state.expiresAt <= now) {
      state.status = "closed";
      state.updatedAt = now;
      state.eventSequence += 1;
      await this.ctx.storage.put(STATE_KEY, state);
      this.broadcastSnapshot(state);
      for (const socket of this.ctx.getWebSockets()) socket.close(4000, "Room expired");
      return;
    }

    const { changed } = expireDisconnectedPlayers(state, now);
    const phaseChanged = handleScheduledTransition(state, now)
      || (changed && state.phase === "question" && allRequiredAnswersSubmitted(state) && revealAnswers(state, now));
    await this.deleteExpiredTickets(now);
    if (changed || phaseChanged) {
      await this.ctx.storage.put(STATE_KEY, state);
      this.broadcastSnapshot(state);
    }
    await this.scheduleNextAlarm(state);
  }

  async webSocketMessage(webSocket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const playerId = this.playerIdForSocket(webSocket);
    if (!playerId) return webSocket.close(4001, "Unauthenticated socket");
    if (typeof rawMessage !== "string") {
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: "unknown", code: "INVALID_MESSAGE", message: "Binary messages are unsupported." });
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawMessage);
    } catch {
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: "unknown", code: "INVALID_MESSAGE", message: "Message must be valid JSON." });
    }
    const parsed = clientCommandSchema.safeParse(decoded);
    if (!parsed.success) {
      const commandId = typeof decoded === "object" && decoded && "commandId" in decoded ? String(decoded.commandId) : "unknown";
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId, code: "INVALID_COMMAND", message: "Command payload is invalid." });
    }

    await this.processCommand(webSocket, playerId, parsed.data);
  }

  async webSocketClose(webSocket: WebSocket): Promise<void> {
    await this.handleSocketGone(webSocket);
  }

  async webSocketError(webSocket: WebSocket): Promise<void> {
    await this.handleSocketGone(webSocket);
  }

  private async claimRoom(request: Request): Promise<Response> {
    const input = await request.json<ClaimRequest>();
    const reconnectToken = createSecret();
    const reconnectTokenHash = await hashSecret(reconnectToken);
    const playerId = crypto.randomUUID();
    const creator = makePlayer({ playerId, nickname: input.creatorNickname, reconnectTokenHash, joinOrder: 1, role: "host", now: input.now });
    creator.presence = "reconnecting";
    creator.disconnectedAt = input.now;
    let state: PrivateRoomState | undefined;
    let claimed = false;

    await this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<StoredClaim>(CLAIM_KEY);
      if (existing) return;
      state = createInitialRoomState({ roomId: input.roomId, roomCode: input.roomCode, creator, now: input.now });
      await transaction.put(CLAIM_KEY, {
        roomCode: input.roomCode,
        roomId: input.roomId,
        creationNonce: input.creationNonce,
        claimedAt: input.now,
      } satisfies StoredClaim);
      await transaction.put(STATE_KEY, state);
      claimed = true;
    });

    if (!claimed || !state) return jsonError("ROOM_CODE_COLLISION", "Room code is already in use.", 409);
    await this.scheduleNextAlarm(state);
    return Response.json(
      { roomCode: input.roomCode, session: { roomCode: input.roomCode, playerId, reconnectToken }, snapshot: toClientSnapshot(state, input.now, playerId) },
      { status: 201 },
    );
  }

  private async joinRoom(request: Request): Promise<Response> {
    const input = await request.json<{ nickname: string }>();
    const now = Date.now();
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    assertRoomAvailable(state, now);

    const reconnectToken = createSecret();
    const reconnectTokenHash = await hashSecret(reconnectToken);
    const playerId = crypto.randomUUID();
    const joinOrder = Math.max(0, ...Object.values(state.players).map((player) => player.joinOrder)) + 1;
    const player = makePlayer({ playerId, nickname: input.nickname, reconnectTokenHash, joinOrder, role: "player", now });
    player.presence = "reconnecting";
    player.disconnectedAt = now;
    addPlayer(state, player, now);
    await this.ctx.storage.put(STATE_KEY, state);
    await this.scheduleNextAlarm(state);
    this.broadcastSnapshot(state);

    return Response.json(
      { roomCode: state.roomCode, session: { roomCode: state.roomCode, playerId, reconnectToken }, snapshot: toClientSnapshot(state, now, playerId) },
      { status: 201 },
    );
  }

  private async createSocketTicket(request: Request): Promise<Response> {
    const input = await request.json<SessionRequest>();
    const now = Date.now();
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    assertRoomAvailable(state, now);
    await this.verifySession(state, input);
    const ticket = createSecret(24);
    const ticketHash = await hashSecret(ticket);
    await this.ctx.storage.put(`${TICKET_PREFIX}${ticketHash}`, { ticketHash, playerId: input.playerId, expiresAt: now + SOCKET_TICKET_TTL_MS } satisfies SocketTicketState);
    await this.scheduleNextAlarm(state);
    return Response.json({ ticket, expiresAt: now + SOCKET_TICKET_TTL_MS });
  }

  private async getAuthenticatedSnapshot(request: Request): Promise<Response> {
    const input = await request.json<SessionRequest>();
    const now = Date.now();
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    assertRoomAvailable(state, now);
    await this.verifySession(state, input);
    return Response.json({ snapshot: toClientSnapshot(state, now, input.playerId) });
  }

  private async acceptWebSocket(url: URL): Promise<Response> {
    const ticket = url.searchParams.get("ticket");
    if (!ticket) return jsonError("MISSING_TICKET", "Socket ticket is required.", 401);
    const ticketHash = await hashSecret(ticket);
    const key = `${TICKET_PREFIX}${ticketHash}`;
    const storedTicket = await this.ctx.storage.get<SocketTicketState>(key);
    if (!storedTicket || storedTicket.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(key);
      return jsonError("INVALID_TICKET", "Socket ticket is invalid or expired.", 401);
    }
    await this.ctx.storage.delete(key);

    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    assertRoomAvailable(state, Date.now());
    markPlayerConnected(state, storedTicket.playerId, Date.now());
    await this.ctx.storage.put(STATE_KEY, state);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [playerTag(storedTicket.playerId)]);
    this.broadcastSnapshot(state);
    await this.scheduleNextAlarm(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async processCommand(webSocket: WebSocket, socketPlayerId: string, command: ClientCommand): Promise<void> {
    const now = Date.now();
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    if (!state || state.status === "closed") {
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: command.commandId, code: "ROOM_NOT_FOUND", message: "Room is no longer active." });
    }
    if (command.playerId !== socketPlayerId || command.roomCode !== state.roomCode) {
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: command.commandId, code: "PLAYER_MISMATCH", message: "Command identity does not match this connection." });
    }

    const existing = state.processedCommands[command.commandId];
    if (existing) {
      if (existing.result === "accepted") {
        return this.send(webSocket, { type: "COMMAND_ACCEPTED", commandId: command.commandId, eventSequence: state.eventSequence, duplicate: true });
      }
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: command.commandId, code: "ALREADY_REJECTED", message: "This command was already rejected." });
    }

    if (command.type === "PING") {
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "accepted");
      await this.ctx.storage.put(STATE_KEY, state);
      return this.send(webSocket, { type: "PONG", serverNow: now, clientNow: command.clientNow });
    }

    if (command.expectedPhaseVersion !== state.phaseVersion) {
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "rejected");
      await this.ctx.storage.put(STATE_KEY, state);
      return this.send(webSocket, { type: "COMMAND_REJECTED", commandId: command.commandId, code: "STALE_PHASE", message: "Room state changed. A fresh snapshot is required." });
    }

    if (command.type === "REQUEST_SNAPSHOT") {
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "accepted");
      await this.ctx.storage.put(STATE_KEY, state);
      this.send(webSocket, { type: "ROOM_SNAPSHOT", snapshot: toClientSnapshot(state, now, socketPlayerId) });
      return this.send(webSocket, { type: "COMMAND_ACCEPTED", commandId: command.commandId, eventSequence: state.eventSequence });
    }

    if (command.type === "LEAVE_ROOM") {
      leavePlayer(state, socketPlayerId, now);
      if (state.phase === "question" && allRequiredAnswersSubmitted(state)) revealAnswers(state, now);
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "accepted");
      await this.ctx.storage.put(STATE_KEY, state);
      this.send(webSocket, { type: "COMMAND_ACCEPTED", commandId: command.commandId, eventSequence: state.eventSequence });
      this.broadcastSnapshot(state);
      for (const socket of this.socketsForPlayer(socketPlayerId)) socket.close(1000, "Player left room");
      await this.scheduleNextAlarm(state);
      return;
    }

    try {
      if (command.type === "SAVE_SETUP") {
        saveHostSetup(state, socketPlayerId, command.questions, now);
      } else if (command.type === "LOCK_SETUP") {
        lockHostSetup(state, socketPlayerId, now);
      } else if (command.type === "START_GAME") {
        startGame(state, socketPlayerId, now);
      } else if (command.type === "SUBMIT_ANSWER") {
        const shouldReveal = submitAnswer(state, socketPlayerId, command.answer, now);
        if (shouldReveal) revealAnswers(state, now);
      } else if (command.type === "ADVANCE_PHASE") {
        if (state.hostPlayerId !== socketPlayerId) throw new GameError("HOST_ONLY", "Only the host can continue.");
        if (!advancePhase(state, now)) throw new GameError("INVALID_PHASE", "The game cannot advance from this screen.");
      } else if (command.type === "SET_UP_ANOTHER_GAME") {
        setUpAnotherGame(state, socketPlayerId, now);
      } else {
        throw new GameError("INVALID_PHASE", "Command is not available right now.");
      }
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "accepted");
      await this.ctx.storage.put(STATE_KEY, state);
      this.broadcastSnapshot(state);
      // Deliver the authoritative snapshot before resolving the initiating
      // command so the next UI action uses the new phaseVersion.
      this.send(webSocket, { type: "COMMAND_ACCEPTED", commandId: command.commandId, eventSequence: state.eventSequence });
      await this.scheduleNextAlarm(state);
    } catch (error) {
      const code = error instanceof GameError ? error.code : "COMMAND_FAILED";
      const message = error instanceof Error ? error.message : "Command could not be completed.";
      recordProcessedCommand(state, command.commandId, socketPlayerId, now, "rejected");
      await this.ctx.storage.put(STATE_KEY, state);
      this.send(webSocket, { type: "COMMAND_REJECTED", commandId: command.commandId, code, message });
    }
  }

  private async verifySession(state: PrivateRoomState, input: SessionRequest): Promise<void> {
    const player = state.players[input.playerId];
    if (!player || player.presence === "left") throw new LobbyError("INVALID_SESSION", "Player session is no longer active.");
    const suppliedHash = await hashSecret(input.reconnectToken);
    if (!secretsEqual(suppliedHash, player.reconnectTokenHash)) throw new LobbyError("INVALID_SESSION", "Reconnect credentials are invalid.");
  }

  private async handleSocketGone(webSocket: WebSocket): Promise<void> {
    if (this.finalizedSockets.has(webSocket)) return;
    this.finalizedSockets.add(webSocket);
    const playerId = this.playerIdForSocket(webSocket);
    if (!playerId) return;
    const storedState = await this.ctx.storage.get<PrivateRoomState>(STATE_KEY);
    const state = storedState ? upgradeState(storedState) : undefined;
    if (!state || state.status === "closed") return;
    const changed = markPlayerDisconnected(state, playerId, Date.now());
    if (!changed) return;
    await this.ctx.storage.put(STATE_KEY, state);
    this.broadcastSnapshot(state);
    await this.scheduleNextAlarm(state);
  }

  private playerIdForSocket(socket: WebSocket): string | null {
    const tag = this.ctx.getTags(socket).find((value) => value.startsWith("player:"));
    return tag?.slice("player:".length) ?? null;
  }

  private socketsForPlayer(playerId: string): WebSocket[] {
    return this.ctx.getWebSockets(playerTag(playerId));
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try { socket.send(JSON.stringify(message)); } catch { /* closed between lookup and send */ }
  }

  private broadcastSnapshot(state: PrivateRoomState): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const playerId = this.playerIdForSocket(socket);
      if (playerId) this.send(socket, { type: "ROOM_SNAPSHOT", snapshot: toClientSnapshot(state, now, playerId) });
    }
  }

  private async deleteExpiredTickets(now: number): Promise<void> {
    const tickets = await this.ctx.storage.list<SocketTicketState>({ prefix: TICKET_PREFIX });
    const expiredKeys = [...tickets.entries()].filter(([, ticket]) => ticket.expiresAt <= now).map(([key]) => key);
    if (expiredKeys.length) await this.ctx.storage.delete(expiredKeys);
  }

  private async scheduleNextAlarm(state: PrivateRoomState): Promise<void> {
    const ticketStates = await this.ctx.storage.list<SocketTicketState>({ prefix: TICKET_PREFIX });
    const ticketDeadlines = [...ticketStates.values()].map((ticket) => ticket.expiresAt);
    const deadlines = [state.expiresAt, nextPresenceDeadline(state), state.scheduledTransition?.deadline ?? null, ...ticketDeadlines]
      .filter((value): value is number => value !== null);
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }
}
