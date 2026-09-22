import { useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import { QuickPasswordGenerator } from "./QuickPasswordGenerator";
import { VaultTopBar, type VaultTopBarProps } from "./VaultChrome";
import { useSaveShortcut } from "./useSaveShortcut";

type VaultToolbarProps = Omit<
  VaultTopBarProps,
  "onGenerator" | "generatorUnavailable"
> & {
  api: DesktopApi;
  privacyVersion: number;
  settingsOpen: boolean;
};

export function VaultToolbar({
  api,
  privacyVersion,
  settingsOpen,
  ...toolbar
}: VaultToolbarProps) {
  const [generatorOpen, setGeneratorOpen] = useState(false);
  useSaveShortcut({
    blocked: toolbar.saveUnavailable,
    settingsOpen: settingsOpen || generatorOpen,
    onSave: toolbar.onSave,
  });

  return (
    <>
      <VaultTopBar
        {...toolbar}
        shortcutsDisabled={toolbar.shortcutsDisabled || generatorOpen}
        generatorUnavailable={toolbar.shortcutsDisabled || generatorOpen}
        onGenerator={() => {
          setGeneratorOpen(true);
        }}
      />
      {generatorOpen ? (
        <QuickPasswordGenerator
          api={api}
          disabled={toolbar.disabled}
          privacyVersion={privacyVersion}
          onClose={() => {
            setGeneratorOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
