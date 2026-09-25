import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientCommand, PublicRoomSnapshot, ServerMessage } from "../protocol/messages";
import { createRoom, createSocketTicket, fetchRoomSnapshot, joinRoom, RoomApiError, socketUrl } from "./room-client";
import { clearSession, loadSession, saveSession, type PlayerSession } from "./session";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export function useRoomLobby() {
  const [session, setSession] = useState<PlayerSession | null>(() => loadSession());
  const [snapshot, setSnapshot] = useState<PublicRoomSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(session ? "connecting" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const connectionGenerationRef = useRef(0);
  const leavingRef = useRef(false);
  const pendingRef = useRef(new Map<string, (accepted: boolean) => void>());

  const friendlyError = useCallback((caught: unknown, fallback: string) => {
    if (caught instanceof RoomApiError) {
      if (caught.code === "INVALID_SESSION") return "Your reconnect window expired. Rejoin the room with your nickname.";
      if (caught.code === "ROOM_NOT_FOUND") return "That room could not be found. Check the code and try again.";
      if (caught.code === "ROOM_EXPIRED") return "That room has expired. Create a new room to keep playing.";
      return caught.message;
    }
    return caught instanceof TypeError ? "Could not reach SyncUp. Check your connection and try again." : fallback;
  }, []);

  const acceptSession = useCallback((nextSession: PlayerSession, initialSnapshot: PublicRoomSnapshot) => {
    saveSession(nextSession);
    leavingRef.current = false;
    setSession(nextSession);
    setSnapshot(initialSnapshot);
    setError(null);
  }, []);

  const create = useCallback(async (nickname: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await createRoom(nickname);
      acceptSession(result.session, result.snapshot);
    } catch (caught) {
      setError(friendlyError(caught, "Could not create the room. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [acceptSession, friendlyError]);

  const join = useCallback(async (nickname: string, roomCode: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await joinRoom(nickname, roomCode);
      acceptSession(result.session, result.snapshot);
    } catch (caught) {
      setError(friendlyError(caught, "Could not join the room. Please try again."));
    } finally {
      setBusy(false);
    }
  }, [acceptSession, friendlyError]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    };

    const scheduleReconnect = (connect: () => Promise<void>, delay: number) => {
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (cancelled || leavingRef.current) return;
      const generation = ++connectionGenerationRef.current;
      clearReconnectTimer();
      setConnectionState(reconnectAttemptRef.current ? "reconnecting" : "connecting");
      try {
        const freshSnapshot = await fetchRoomSnapshot(session);
        if (cancelled || generation !== connectionGenerationRef.current) return;
        setSnapshot((current) => !current || freshSnapshot.eventSequence >= current.eventSequence ? freshSnapshot : current);
        const ticket = await createSocketTicket(session);
        if (cancelled || generation !== connectionGenerationRef.current) return;
        const socket = new WebSocket(socketUrl(session, ticket));
        socketRef.current = socket;

        socket.addEventListener("open", () => {
          if (cancelled || generation !== connectionGenerationRef.current) return socket.close();
          reconnectAttemptRef.current = 0;
          setConnectionState("connected");
          setError(null);
        });
        socket.addEventListener("message", (event) => {
          if (generation !== connectionGenerationRef.current) return;
          let message: ServerMessage;
          try { message = JSON.parse(String(event.data)) as ServerMessage; }
          catch { return; }
          if (message.type === "ROOM_SNAPSHOT") {
            setSnapshot((current) => !current || message.snapshot.eventSequence >= current.eventSequence ? message.snapshot : current);
          } else if (message.type === "COMMAND_ACCEPTED") {
            pendingRef.current.get(message.commandId)?.(true);
            pendingRef.current.delete(message.commandId);
          } else if (message.type === "COMMAND_REJECTED") {
            pendingRef.current.get(message.commandId)?.(false);
            pendingRef.current.delete(message.commandId);
            setError(message.message);
          }
        });
        socket.addEventListener("close", () => {
          if (socketRef.current === socket) socketRef.current = null;
          if (cancelled || leavingRef.current || generation !== connectionGenerationRef.current) return;
          setConnectionState(navigator.onLine ? "reconnecting" : "offline");
          reconnectAttemptRef.current += 1;
          const delay = Math.min(4_000, 300 * 2 ** reconnectAttemptRef.current) + Math.floor(Math.random() * 200);
          scheduleReconnect(connect, delay);
        });
        socket.addEventListener("error", () => socket.close());
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof RoomApiError && [401, 404, 410].includes(caught.status)) {
          clearSession();
          setSession(null);
          setSnapshot(null);
          setConnectionState("idle");
          setError(friendlyError(caught, "Your session could not be restored."));
          return;
        }
        setConnectionState(navigator.onLine ? "reconnecting" : "offline");
        reconnectAttemptRef.current += 1;
        scheduleReconnect(connect, Math.min(4_000, 400 * 2 ** reconnectAttemptRef.current));
      }
    };

    const handleOnline = () => {
      if (cancelled || leavingRef.current || socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING) return;
      reconnectAttemptRef.current = 0;
      void connect();
    };
    const handleOffline = () => setConnectionState("offline");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void connect();
    return () => {
      cancelled = true;
      connectionGenerationRef.current += 1;
      clearReconnectTimer();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      socketRef.current?.close();
      socketRef.current = null;
      for (const resolve of pendingRef.current.values()) resolve(false);
      pendingRef.current.clear();
    };
  }, [friendlyError, session]);

  const sendCommand = useCallback((type: ClientCommand["type"], payload: Record<string, unknown> = {}): Promise<boolean> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !session || !snapshot) return Promise.resolve(false);
    const commandId = crypto.randomUUID();
    return new Promise((resolve) => {
      pendingRef.current.set(commandId, resolve);
      socket.send(JSON.stringify({ type, commandId, roomCode: session.roomCode, playerId: session.playerId, expectedPhaseVersion: snapshot.phaseVersion, ...payload }));
      window.setTimeout(() => {
        if (!pendingRef.current.has(commandId)) return;
        pendingRef.current.delete(commandId);
        resolve(false);
      }, 3_000);
    });
  }, [session, snapshot]);

  const leave = useCallback(async () => {
    leavingRef.current = true;
    await sendCommand("LEAVE_ROOM");
    socketRef.current?.close();
    clearSession();
    setSession(null);
    setSnapshot(null);
    setConnectionState("idle");
    setError(null);
  }, [sendCommand]);

  const runGameCommand = useCallback(async (type: "START_GAME" | "ADVANCE_PHASE" | "PLAY_AGAIN") => {
    setCommandBusy(true);
    setError(null);
    try { return await sendCommand(type); }
    finally { setCommandBusy(false); }
  }, [sendCommand]);

  const submitAnswer = useCallback(async (answer: string) => {
    setCommandBusy(true);
    setError(null);
    try { return await sendCommand("SUBMIT_ANSWER", { answer }); }
    finally { setCommandBusy(false); }
  }, [sendCommand]);

  return {
    session, snapshot, connectionState, error, busy, commandBusy, create, join, leave,
    startGame: () => runGameCommand("START_GAME"),
    advancePhase: () => runGameCommand("ADVANCE_PHASE"),
    playAgain: () => runGameCommand("PLAY_AGAIN"),
    submitAnswer,
  };
}
