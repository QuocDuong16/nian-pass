import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { mutationApi, mutationSnapshot } from "../../test/desktop-api";
import { EntryAttachmentsSection } from "./EntryAttachmentsSection";
import { attachmentErrorMessage, formatAttachmentSize } from "./attachment-ui";

const attachments = [
  { name: "manual.pdf", sizeBytes: 1_536, protected: true },
  { name: "logo.png", sizeBytes: 3_145_728, protected: false },
];

afterEach(cleanup);

test("attachment metadata loads lazily without carrying attachment bytes", async () => {
  const getEntryAttachments = vi.fn().mockResolvedValue(attachments);
  const api = mutationApi({ getEntryAttachments });
  render(
    <EntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      mutationDisabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  expect(getEntryAttachments).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByText("manual.pdf")).toBeVisible();
  expect(getEntryAttachments).toHaveBeenCalledWith("entry-a");
  expect(screen.getByText("1.5 KiB · protected")).toBeVisible();
  expect(screen.getByText("3.0 MiB")).toBeVisible();
  expect(screen.queryByText(/attachment bytes/i)).not.toBeInTheDocument();
});

test("read-only mutation gate still permits explicit native export", async () => {
  const exportEntryAttachment = vi.fn().mockResolvedValue({ exported: true });
  const api = mutationApi({
    getEntryAttachments: vi.fn().mockResolvedValue([attachments[0]]),
    exportEntryAttachment,
  });
  render(
    <EntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      mutationDisabled
      onSnapshot={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await screen.findByText("manual.pdf");
  const exportButton = screen.getByRole("button", { name: "Export" });
  expect(exportButton).toBeEnabled();
  fireEvent.click(exportButton);

  await waitFor(() => {
    expect(exportEntryAttachment).toHaveBeenCalledWith("entry-a", "manual.pdf");
  });
  expect(await screen.findByText("Attachment exported.")).toBeVisible();
});

test("import returns the canonical Rust snapshot and maps bounded import errors", async () => {
  const importEntryAttachment = vi
    .fn()
    .mockResolvedValueOnce(mutationSnapshot)
    .mockRejectedValueOnce(new DesktopCommandError("attachment_too_large"))
    .mockRejectedValueOnce(
      new DesktopCommandError("attachment_already_exists"),
    );
  const onSnapshot = vi.fn();
  const api = mutationApi({ importEntryAttachment });
  render(
    <EntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      mutationDisabled={false}
      onSnapshot={onSnapshot}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() => {
    expect(onSnapshot).toHaveBeenCalledWith(mutationSnapshot);
  });

  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByText(/larger than 64 MiB/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText(/filename already exists/)).toBeVisible();
  expect(importEntryAttachment).toHaveBeenCalledTimes(3);
});

test("load can retry and missing export invalidates cached metadata", async () => {
  const getEntryAttachments = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic load failure"))
    .mockResolvedValueOnce([attachments[0]])
    .mockResolvedValueOnce([]);
  const api = mutationApi({
    getEntryAttachments,
    exportEntryAttachment: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("attachment_not_found")),
  });
  render(
    <EntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      mutationDisabled={false}
      onSnapshot={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load/);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("manual.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByText(/no longer available/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Hide" }));
  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByText("No attachments.")).toBeVisible();
  expect(getEntryAttachments).toHaveBeenCalledTimes(3);
});

test("cancelled import and export remain non-mutating presentation outcomes", async () => {
  const onSnapshot = vi.fn();
  const api = mutationApi({
    getEntryAttachments: vi.fn().mockResolvedValue([attachments[0]]),
    importEntryAttachment: vi.fn().mockResolvedValue(null),
    exportEntryAttachment: vi.fn().mockResolvedValue(null),
  });
  render(
    <EntryAttachmentsSection
      api={api}
      entryId="entry-a"
      disabled={false}
      mutationDisabled={false}
      onSnapshot={onSnapshot}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Show" }));
  await screen.findByText("manual.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText("Import cancelled.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(await screen.findByText("Export cancelled.")).toBeVisible();
  expect(onSnapshot).not.toHaveBeenCalled();
});

test("attachment error mapping covers generic, file I/O, and unrelated desktop failures", () => {
  expect(attachmentErrorMessage(new Error("boom"), "import")).toBe(
    "Could not import the attachment.",
  );
  expect(
    attachmentErrorMessage(
      new DesktopCommandError("attachment_io_failed"),
      "export",
    ),
  ).toBe("Could not export the attachment file.");
  expect(
    attachmentErrorMessage(
      new DesktopCommandError("invalid_request"),
      "import",
    ),
  ).toBe("Could not import the attachment.");
});

test("attachment size formatting stays compact and deterministic", () => {
  expect(formatAttachmentSize(12)).toBe("12 B");
  expect(formatAttachmentSize(1_024)).toBe("1.0 KiB");
  expect(formatAttachmentSize(1_048_576)).toBe("1.0 MiB");
});
