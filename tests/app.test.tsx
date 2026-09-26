import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { clearSession, loadSession, saveSession } from "../src/api/session";
import { HomeScreen } from "../src/components/HomeScreen";
import { FinalScreen } from "../src/components/ResultScreens";
import type { PublicRoomSnapshot } from "../src/protocol/messages";

afterEach(() => {
  cleanup();
  clearSession();
  window.history.replaceState({}, "", "/");
});

describe("SyncUp room entry", () => {
  it("requires a nickname before room creation", () => {
    render(<HomeScreen onCreate={vi.fn()} onJoin={vi.fn()} busy={false} error={null} />);
    expect(screen.getByRole("heading", { name: /match answers.*score together/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a room/i })).toBeDisabled();
  });

  it("submits the entered nickname to the real create handler", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<HomeScreen onCreate={onCreate} onJoin={vi.fn()} busy={false} error={null} />);
    fireEvent.change(screen.getByPlaceholderText(/what should we call you/i), { target: { value: "Tagore" } });
    fireEvent.click(screen.getByRole("button", { name: /create a room/i }));
    expect(onCreate).toHaveBeenCalledWith("Tagore");
  });

  it("opens a compact keyboard-dismissible How to Play dialog", () => {
    render(<HomeScreen onCreate={vi.fn()} onJoin={vi.fn()} busy={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(screen.getByRole("dialog", { name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByText(/2 to 8 people/i)).toBeInTheDocument();
    expect(screen.getByText(/300 points each/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /how to play/i })).not.toBeInTheDocument();
  });
});

describe("launch routes and final actions", () => {
  it.each([
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms and Conditions"],
  ])("renders %s as a direct SPA route", (path, heading) => {
    window.history.replaceState({}, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SyncUp home" })).toHaveAttribute("href", "/");
  });

  it("explains why Play Again is unavailable and offers Exit to Home", () => {
    const snapshot = {
      phase: "final",
      roomCode: "ABC234",
      status: "finished",
      roundNumber: 5,
      totalRounds: 5,
      phaseVersion: 12,
      eventSequence: 20,
      serverNow: Date.now(),
      hostPlayerId: "host",
      players: [{ playerId: "host", nickname: "Tagore", role: "host", presence: "connected", score: 300 }],
      phaseEndsAt: null,
      leaderboard: [{ playerId: "host", nickname: "Tagore", rank: 1, score: 300, roundPoints: 100, presence: "connected" }],
      winnerPlayerIds: ["host"],
    } as Extract<PublicRoomSnapshot, { phase: "final" }>;
    const onExit = vi.fn().mockResolvedValue(undefined);
    render(<FinalScreen snapshot={snapshot} currentPlayerId="host" commandBusy={false} onReplay={vi.fn()} onExit={onExit} />);
    expect(screen.getByText("At least 2 players are needed to play again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play again/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /exit to home/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("clears the stored anonymous room session", () => {
    saveSession({ roomCode: "ABC234", playerId: crypto.randomUUID(), reconnectToken: "temporary-token" });
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
