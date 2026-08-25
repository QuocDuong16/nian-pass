import { useEffect, useState } from "react";

import App from "../App";
import {
  desktopApi,
  runtimeApi,
  type DesktopApi,
  type RuntimeApi,
} from "../lib/desktop";
import {
  desktopWindowLifecycle,
  type DesktopWindowLifecycle,
} from "../lib/window-lifecycle";
import type { RuntimeInfoDto } from "../types/runtime";
import { MobileFoundationView } from "./MobileFoundationView";

interface ApplicationRootProps {
  api?: DesktopApi;
  runtime?: RuntimeApi;
  windowLifecycle?: DesktopWindowLifecycle | null;
}

export function ApplicationRoot({
  api = desktopApi,
  runtime = runtimeApi,
  windowLifecycle = desktopWindowLifecycle,
}: ApplicationRootProps) {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfoDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void runtime
      .getInfo()
      .then((info) => {
        if (active) setRuntimeInfo(info);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [runtime]);

  if (failed) {
    return (
      <main className="fatal-view">
        <section className="fatal-card" role="alert">
          Nian Pass could not verify the runtime platform.
        </section>
      </main>
    );
  }
  if (runtimeInfo === null) {
    return <main className="runtime-loading">Starting Nian Pass…</main>;
  }
  if (runtimeInfo.platform === "desktop") {
    return <App api={api} windowLifecycle={windowLifecycle} />;
  }
  return <MobileFoundationView platform={runtimeInfo.platform} />;
}
