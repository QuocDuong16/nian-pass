import { vi } from "vitest";

import { DetectionController } from "./detection-controller";

describe("MutationObserver detection", () => {
  beforeEach(() => {
    document.body.textContent = "";
    vi.useFakeTimers();
  });

  afterEach(() => vi.useRealTimers());

  test("reports dynamic insertion and removal", async () => {
    const reports: unknown[] = [];
    const controller = new DetectionController(
      document,
      "a".repeat(32),
      (message) => {
        reports.push(message);
      },
      20,
    );
    controller.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(reports).toHaveLength(1);
    const form = document.createElement("form");
    const password = document.createElement("input");
    password.type = "password";
    form.append(password);
    document.body.append(form);
    await vi.advanceTimersByTimeAsync(20);
    expect(reports).toHaveLength(2);
    form.remove();
    await vi.advanceTimersByTimeAsync(20);
    expect(reports).toHaveLength(3);
    controller.stop();
  });

  test("coalesces many mutations and suppresses duplicate signatures", async () => {
    const reports: unknown[] = [];
    const controller = new DetectionController(
      document,
      "b".repeat(32),
      (message) => {
        reports.push(message);
      },
      10,
    );
    controller.start();
    for (let index = 0; index < 100; index += 1)
      document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(10);
    expect(reports).toHaveLength(1);
    document.body.append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(10);
    expect(reports).toHaveLength(1);
    controller.stop();
  });
});
