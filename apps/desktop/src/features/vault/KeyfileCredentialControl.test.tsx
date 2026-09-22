import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { DesktopCommandError } from "../../lib/desktop";
import { mutationApi } from "../../test/desktop-api";
import { KeyfileCredentialControl } from "./KeyfileCredentialControl";

afterEach(cleanup);

test("adds a keyfile through the native semantic command without exposing bytes or paths", async () => {
  const credentialHasKeyfile = vi.fn().mockResolvedValue(false);
  const replaceKeyfile = vi
    .fn()
    .mockResolvedValue({ fileName: "account-recovery.keyx" });
  const api = mutationApi({ credentialHasKeyfile, replaceKeyfile });
  const onBusyChange = vi.fn();

  render(
    <KeyfileCredentialControl
      api={api}
      disabled={false}
      dirty={false}
      onBusyChange={onBusyChange}
    />,
  );

  expect(
    await screen.findByText(
      "No keyfile is part of the current vault credential.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add keyfile" }));

  expect(
    await screen.findByText(
      "Keyfile credential updated from account-recovery.keyx.",
    ),
  ).toBeVisible();
  expect(replaceKeyfile).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Replace keyfile" })).toBeVisible();
  expect(onBusyChange).toHaveBeenNthCalledWith(1, true);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

test("removing a keyfile requires an explicit confirmation and updates the local credential state", async () => {
  const removeKeyfile = vi.fn().mockResolvedValue(undefined);
  const api = mutationApi({
    credentialHasKeyfile: vi.fn().mockResolvedValue(true),
    removeKeyfile,
  });

  render(
    <KeyfileCredentialControl
      api={api}
      disabled={false}
      dirty={false}
      onBusyChange={vi.fn()}
    />,
  );

  expect(
    await screen.findByRole("button", { name: "Remove keyfile" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove keyfile" }));
  expect(removeKeyfile).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: "Confirm remove keyfile" }),
  );
  expect(
    await screen.findByText(
      "Keyfile removed. The retained master password now protects the vault.",
    ),
  ).toBeVisible();
  expect(removeKeyfile).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Add keyfile" })).toBeVisible();
});

test("keyfile-only removal failure is explicit and refreshes the proven component state", async () => {
  const credentialHasKeyfile = vi.fn().mockResolvedValue(true);
  const api = mutationApi({
    credentialHasKeyfile,
    removeKeyfile: vi
      .fn()
      .mockRejectedValue(new DesktopCommandError("invalid_request")),
  });

  render(
    <KeyfileCredentialControl
      api={api}
      disabled={false}
      dirty={false}
      onBusyChange={vi.fn()}
    />,
  );

  fireEvent.click(
    await screen.findByRole("button", { name: "Remove keyfile" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm remove keyfile" }),
  );

  expect(
    await screen.findByText(
      "The keyfile is the vault's only credential component. Set a master password before removing it.",
    ),
  ).toBeVisible();
  expect(credentialHasKeyfile).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Replace keyfile" })).toBeVisible();
});

test("dirty or otherwise disabled credential state blocks keyfile rotation", async () => {
  const replaceKeyfile = vi.fn();
  const api = mutationApi({
    credentialHasKeyfile: vi.fn().mockResolvedValue(false),
    replaceKeyfile,
  });

  render(
    <KeyfileCredentialControl
      api={api}
      disabled
      dirty
      onBusyChange={vi.fn()}
    />,
  );

  expect(
    await screen.findByText(
      "Save or discard unsaved vault changes before changing the keyfile.",
    ),
  ).toBeVisible();
  const add = screen.getByRole("button", { name: "Add keyfile" });
  expect(add).toBeDisabled();
  fireEvent.click(add);
  expect(replaceKeyfile).not.toHaveBeenCalled();
});
