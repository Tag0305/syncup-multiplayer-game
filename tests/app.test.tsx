import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "../src/components/HomeScreen";

afterEach(cleanup);

describe("SyncUp room entry", () => {
  it("requires a nickname before room creation", () => {
    render(<HomeScreen onCreate={vi.fn()} onJoin={vi.fn()} busy={false} error={null} />);
    expect(screen.getByRole("heading", { name: /how well do your minds/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create a room/i })).toBeDisabled();
  });

  it("submits the entered nickname to the real create handler", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<HomeScreen onCreate={onCreate} onJoin={vi.fn()} busy={false} error={null} />);
    fireEvent.change(screen.getByPlaceholderText(/what should we call you/i), { target: { value: "Tagore" } });
    fireEvent.click(screen.getByRole("button", { name: /create a room/i }));
    expect(onCreate).toHaveBeenCalledWith("Tagore");
  });
});
