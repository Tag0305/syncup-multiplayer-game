import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { connectionNoticeText } from "../src/App";
import { clearSession, loadSession, saveSession } from "../src/api/session";
import { HomeScreen } from "../src/components/HomeScreen";
import { HostSetupScreen } from "../src/components/HostSetupScreen";
import { FinalScreen } from "../src/components/ResultScreens";
import type { ClientRoomSnapshot, PublicRoomSnapshot } from "../src/protocol/messages";

afterEach(() => {
  cleanup();
  clearSession();
  window.history.replaceState({}, "", "/");
});

describe("SyncUp room entry", () => {
  it("requires a nickname before room creation", () => {
    render(<HomeScreen onCreate={vi.fn()} onJoin={vi.fn()} busy={false} error={null} />);
    expect(screen.getByRole("heading", { name: /how well do you.*know the host/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create game/i })).toBeDisabled();
  });

  it("submits the entered nickname to the real create handler", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<HomeScreen onCreate={onCreate} onJoin={vi.fn()} busy={false} error={null} />);
    fireEvent.change(screen.getByLabelText(/host name/i), { target: { value: "Tagore" } });
    fireEvent.click(screen.getByRole("button", { name: /create game/i }));
    expect(onCreate).toHaveBeenCalledWith("Tagore");
  });

  it("opens a compact keyboard-dismissible How to Play dialog", () => {
    render(<HomeScreen onCreate={vi.fn()} onJoin={vi.fn()} busy={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: /how to play/i }));
    expect(screen.getByRole("dialog", { name: /how to play/i })).toBeInTheDocument();
    expect(screen.getByText(/host creates five questions/i)).toBeInTheDocument();
    expect(screen.getByText(/matching accepted answer earns 100 points/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /how to play/i })).not.toBeInTheDocument();
  });
});

describe("connection status copy", () => {
  it("distinguishes an initial connection from a real reconnect", () => {
    expect(connectionNoticeText("connecting")).toBe("Connecting to your game…");
    expect(connectionNoticeText("reconnecting")).toBe("Connection interrupted. Reconnecting to your game…");
    expect(connectionNoticeText("offline")).toBe("You are offline. SyncUp will reconnect when your connection returns.");
  });
});

describe("host setup alternatives", () => {
  it("saves and reviews optional accepted answers before lock", async () => {
    const snapshot = {
      phase: "setup",
      roomCode: "ABC234",
      status: "lobby",
      roundNumber: 0,
      totalRounds: 5,
      phaseVersion: 1,
      eventSequence: 3,
      serverNow: Date.now(),
      hostPlayerId: "host",
      hostName: "Tagore",
      setupStatus: "editing",
      players: [{ playerId: "host", nickname: "Tagore", role: "host", presence: "connected", score: 0 }],
      phaseEndsAt: null,
      hostSetup: {
        questions: Array.from({ length: 5 }, (_, index) => ({
          question: `Question ${index + 1}?`,
          answer: index === 0 ? "Mutton Biriyani" : `Answer ${index + 1}`,
          acceptedAnswers: index === 0 ? ["Biriyani", "Biryani"] : [],
        })),
      },
    } as Extract<ClientRoomSnapshot, { phase: "setup" }>;
    const onSave = vi.fn().mockResolvedValue(true);
    render(<HostSetupScreen snapshot={snapshot} currentPlayerId="host" connectionState="connected" commandBusy={false} onSave={onSave} onLock={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getAllByText(/add other answers that should also count as correct/i)).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: /review game/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0][0].acceptedAnswers).toEqual(["Biriyani", "Biryani"]);
    expect(screen.getByText("Biriyani")).toBeInTheDocument();
    expect(screen.getByText("Biryani")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  it("offers a fresh host setup and Exit to Home without round-only copy", () => {
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
      hostName: "Tagore",
      setupStatus: "locked",
      players: [
        { playerId: "host", nickname: "Tagore", role: "host", presence: "connected", score: 0 },
        { playerId: "p1", nickname: "Alex", role: "player", presence: "connected", score: 300 },
      ],
      phaseEndsAt: null,
      leaderboard: [{ playerId: "p1", nickname: "Alex", rank: 1, score: 300, roundPoints: 100, presence: "connected" }],
      winnerPlayerIds: ["p1"],
    } as Extract<PublicRoomSnapshot, { phase: "final" }>;
    const onExit = vi.fn().mockResolvedValue(undefined);
    render(<FinalScreen snapshot={snapshot} currentPlayerId="host" commandBusy={false} onNewGame={vi.fn()} onExit={onExit} />);
    expect(screen.getByRole("button", { name: /set up another game/i })).toBeInTheDocument();
    expect(screen.queryByText(/no points this round/i)).not.toBeInTheDocument();
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
