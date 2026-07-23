import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Options from "@pages/options/Options";
import * as rpc from "@utils/chromeRPC";

vi.mock("@utils/chromeRPC", () => ({
  getCompletionAlarmSetting: vi.fn(),
  setCompletionAlarmSetting: vi.fn(),
}));

const mockedRpc = vi.mocked(rpc);

describe("Options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRpc.getCompletionAlarmSetting.mockResolvedValue(true);
    mockedRpc.setCompletionAlarmSetting.mockResolvedValue(true);
  });

  it("loads and renders alarm setting state", async () => {
    render(<Options />);

    const toggle = await screen.findByRole("checkbox", {
      name: "Play smooth completion alarm",
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Court Interpreter Toolkit" }),
    ).toBeInTheDocument();
    expect(
      screen.getByAltText("Court Interpreter Toolkit options hero"),
    ).toBeInTheDocument();
  });

  it("updates alarm setting and shows saved status", async () => {
    mockedRpc.setCompletionAlarmSetting.mockResolvedValue(false);

    render(<Options />);

    const toggle = (await screen.findByRole("checkbox", {
      name: "Play smooth completion alarm",
    })) as HTMLInputElement;

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockedRpc.setCompletionAlarmSetting).toHaveBeenCalledWith(false);
    });

    await waitFor(() => {
      expect(toggle.checked).toBe(false);
      expect(screen.getByText("Off")).toBeInTheDocument();
      expect(screen.getByText("Saved.")).toHaveClass("visible");
    });
  });

  it("shows an alert and re-enables the toggle when the initial setting load fails", async () => {
    mockedRpc.getCompletionAlarmSetting.mockRejectedValue(new Error("load failed"));

    render(<Options />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("load failed");
    expect(screen.getByRole("checkbox", { name: "Play smooth completion alarm" })).not.toBeDisabled();
  });

  it("falls back to a generic message when the load rejection is not an Error", async () => {
    mockedRpc.getCompletionAlarmSetting.mockRejectedValue("boom");

    render(<Options />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to load settings.");
  });

  it("rolls back the toggle and shows an error when persisting the setting fails", async () => {
    mockedRpc.setCompletionAlarmSetting.mockRejectedValue(new Error("save failed"));

    render(<Options />);
    const toggle = (await screen.findByRole("checkbox", {
      name: "Play smooth completion alarm",
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    });
    expect(toggle.checked).toBe(true);
    expect(screen.queryByText("Saved.")).not.toHaveClass("visible");
  });

  it("falls back to a generic message when the save rejection is not an Error", async () => {
    mockedRpc.setCompletionAlarmSetting.mockRejectedValue("boom");

    render(<Options />);
    const toggle = (await screen.findByRole("checkbox", {
      name: "Play smooth completion alarm",
    })) as HTMLInputElement;

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to update setting.");
    });
  });

  it("clears a previously scheduled save indicator timer on a second successful toggle", async () => {
    mockedRpc.setCompletionAlarmSetting.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<Options />);
    const toggle = (await screen.findByRole("checkbox", {
      name: "Play smooth completion alarm",
    })) as HTMLInputElement;

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText("Saved.")).toHaveClass("visible"));

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(mockedRpc.setCompletionAlarmSetting).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Saved.")).toHaveClass("visible");
    });
  });
});
