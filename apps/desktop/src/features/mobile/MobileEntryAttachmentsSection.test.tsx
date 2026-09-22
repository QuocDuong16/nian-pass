import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { createMobileApi, mobileSnapshot } from "../../test/mobile-api";
import { MobileEntryAttachmentsSection } from "./MobileEntryAttachmentsSection";

afterEach(cleanup);

test("attachment metadata stays on-demand and bytes never enter the mobile UI contract", async () => {
  const getEntryAttachments = vi
    .fn()
    .mockResolvedValue([
      { name: "recovery.pdf", sizeBytes: 1536, protected: true },
    ]);
  const api = createMobileApi({ getEntryAttachments });
  render(
    <MobileEntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      readOnly={true}
      nativeActions={false}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );

  expect(getEntryAttachments).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load attachments" }));
  await waitFor(() => {
    expect(getEntryAttachments).toHaveBeenCalledWith("entry-a");
  });
  expect(screen.getByText("recovery.pdf")).toBeInTheDocument();
  expect(screen.getByText("1.5 KiB · protected")).toBeInTheDocument();
  expect(
    screen.getByText("Import and export are unavailable on this platform."),
  ).toBeInTheDocument();
});

test("attachment metadata failure can be retried without changing vault state", async () => {
  const getEntryAttachments = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic"))
    .mockResolvedValueOnce([]);
  const api = createMobileApi({ getEntryAttachments });
  render(
    <MobileEntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      readOnly={true}
      nativeActions={false}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Load attachments" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load attachments.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Load attachments" }));
  expect(await screen.findByText("No attachments.")).toBeInTheDocument();
  expect(getEntryAttachments).toHaveBeenCalledTimes(2);
});

test("Android native attachment actions keep bytes out of React and apply Rust receipts", async () => {
  const getEntryAttachments = vi
    .fn()
    .mockResolvedValue([
      { name: "recovery.pdf", sizeBytes: 1536, protected: true },
    ]);
  const imported = { ...mobileSnapshot, dirty: true };
  const importEntryAttachment = vi.fn().mockResolvedValue(imported);
  const exportEntryAttachment = vi.fn().mockResolvedValue({ exported: true });
  const onSnapshot = vi.fn();
  const api = createMobileApi({
    getEntryAttachments,
    importEntryAttachment,
    exportEntryAttachment,
  });
  render(
    <MobileEntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      readOnly={false}
      nativeActions={true}
      onSnapshot={onSnapshot}
      onBusyChange={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Load attachments" }));
  expect(await screen.findByText("recovery.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(exportEntryAttachment).toHaveBeenCalledWith(
      "entry-a",
      "recovery.pdf",
    );
  });
  expect(await screen.findByText("Attachment exported.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => {
    expect(importEntryAttachment).toHaveBeenCalledWith("entry-a");
  });
  expect(onSnapshot).toHaveBeenCalledWith(imported);
  expect(
    await screen.findByText(
      "Attachment imported. Reload attachments to review it.",
    ),
  ).toBeInTheDocument();
});

test("read-only Android attachment review still permits native export but hides import", async () => {
  const exportEntryAttachment = vi.fn().mockResolvedValue(null);
  const api = createMobileApi({
    getEntryAttachments: vi
      .fn()
      .mockResolvedValue([
        { name: "archive.bin", sizeBytes: 4, protected: true },
      ]),
    exportEntryAttachment,
  });
  render(
    <MobileEntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      readOnly={true}
      nativeActions={true}
      onSnapshot={vi.fn()}
      onBusyChange={vi.fn()}
    />,
  );

  expect(
    screen.queryByRole("button", { name: "Import" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load attachments" }));
  await screen.findByText("archive.bin");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(exportEntryAttachment).toHaveBeenCalledWith(
      "entry-a",
      "archive.bin",
    );
  });
});
