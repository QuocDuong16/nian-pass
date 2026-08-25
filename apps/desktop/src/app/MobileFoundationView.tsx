import type { RuntimePlatform } from "../types/runtime";

interface MobileFoundationViewProps {
  platform: Exclude<RuntimePlatform, "desktop">;
}

export function MobileFoundationView({ platform }: MobileFoundationViewProps) {
  return (
    <main className="mobile-foundation-view">
      <section
        className="mobile-foundation-card"
        aria-labelledby="mobile-title"
      >
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <p className="eyebrow">Mobile foundation</p>
        <h1 id="mobile-title">Nian Pass</h1>
        <p>
          {platform === "android" ? "Android" : "iOS"} runtime ready. Vault
          access arrives in M5.1.
        </p>
      </section>
    </main>
  );
}
