import { RoomDurableObject } from "./room-durable-object";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "./room-code";
import { cleanNickname, LobbyError } from "../game/lobby";

interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
  ASSETS: Fetcher;
}

const MAX_CODE_ATTEMPTS = 12;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let creatorNickname: string;
  try {
    const body = await request.json<{ nickname?: unknown }>();
    creatorNickname = cleanNickname(typeof body.nickname === "string" ? body.nickname : "");
  } catch (error) {
    const message = error instanceof LobbyError ? error.message : "A valid nickname is required.";
    return Response.json({ error: "INVALID_NICKNAME", message }, { status: 400 });
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const roomCode = generateRoomCode(randomBytes(6));
    // idFromName is deterministic: the normalized code always maps to exactly
    // one object in this namespace, across every Worker instance and region.
    const objectId = env.ROOMS.idFromName(roomCode);
    const stub = env.ROOMS.get(objectId);
    const creationNonce = crypto.randomUUID();
    const claim = await stub.fetch("https://room.internal/internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode, roomId: objectId.toString(), creationNonce, creatorNickname, now: Date.now() }),
    });

    if (claim.status === 201) {
      return claim;
    }
    if (claim.status !== 409) return claim;
    // A claim conflict means this random code already belongs to a room. The
    // serialized storage transaction makes the check-and-claim atomic.
  }
  return Response.json({ error: "ROOM_CODE_EXHAUSTED" }, { status: 503 });
}

function roomStub(env: Env, code: string): DurableObjectStub<RoomDurableObject> | null {
  const normalizedCode = normalizeRoomCode(code);
  if (!isValidRoomCode(normalizedCode)) return null;
  return env.ROOMS.get(env.ROOMS.idFromName(normalizedCode));
}

export { RoomDurableObject };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return Response.json({ status: "ok", serverNow: Date.now() });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return createRoom(request, env);
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/join|\/socket-ticket|\/socket|\/snapshot)$/);
    if (roomMatch) {
      const stub = roomStub(env, roomMatch[1]);
      if (!stub) return Response.json({ error: "INVALID_ROOM_CODE", message: "Enter a valid six-character room code." }, { status: 400 });
      const routeMap: Record<string, string> = {
        "/join": "/internal/join",
        "/socket-ticket": "/internal/socket-ticket",
        "/socket": "/socket",
        "/snapshot": "/internal/snapshot",
      };
      const internalUrl = new URL(`https://room.internal${routeMap[roomMatch[2]]}`);
      if (roomMatch[2] === "/socket") internalUrl.search = url.search;
      return stub.fetch(new Request(internalUrl, request));
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
