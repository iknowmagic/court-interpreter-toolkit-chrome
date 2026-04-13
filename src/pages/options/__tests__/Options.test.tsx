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
});
