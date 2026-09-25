import type { PublicRoomSnapshot } from "../protocol/messages";
import type { PlayerSession } from "./session";

interface RoomSessionResponse {
  roomCode: string;
  session: PlayerSession;
  snapshot: PublicRoomSnapshot;
}

export class RoomApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "RoomApiError";
  }
}

async function apiRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new RoomApiError(payload.error ?? "REQUEST_FAILED", payload.message ?? "Something went wrong.", response.status);
  return payload;
}

export function createRoom(nickname: string): Promise<RoomSessionResponse> {
  return apiRequest("/api/rooms", { nickname });
}

export function joinRoom(nickname: string, roomCode: string): Promise<RoomSessionResponse> {
  return apiRequest(`/api/rooms/${encodeURIComponent(roomCode)}/join`, { nickname });
}

export async function createSocketTicket(session: PlayerSession): Promise<string> {
  const result = await apiRequest<{ ticket: string }>(`/api/rooms/${session.roomCode}/socket-ticket`, {
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
  });
  return result.ticket;
}

export async function fetchRoomSnapshot(session: PlayerSession): Promise<PublicRoomSnapshot> {
  const result = await apiRequest<{ snapshot: PublicRoomSnapshot }>(`/api/rooms/${session.roomCode}/snapshot`, {
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
  });
  return result.snapshot;
}

export function socketUrl(session: PlayerSession, ticket: string): string {
  const url = new URL(`/api/rooms/${session.roomCode}/socket`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
