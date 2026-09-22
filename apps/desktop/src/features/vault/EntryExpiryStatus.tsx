import { formatExpiryDisplay, isEntryExpired } from "./entry-expiry";

interface EntryExpiryStatusProps {
  expiresAtUnixSeconds: number | null;
}

export function EntryExpiryStatus({
  expiresAtUnixSeconds,
}: EntryExpiryStatusProps) {
  if (expiresAtUnixSeconds === null) {
    return (
      <section className="detail-field" aria-labelledby="expiry-label">
        <h3 id="expiry-label">Expiry</h3>
        <p>Never</p>
      </section>
    );
  }

  const expired = isEntryExpired(expiresAtUnixSeconds);
  return (
    <section className="detail-field" aria-labelledby="expiry-label">
      <h3 id="expiry-label">Expiry</h3>
      <p className={expired ? "expiry-state expired" : "expiry-state"}>
        <strong>{expired ? "Expired" : "Expires"}</strong>{" "}
        <time dateTime={new Date(expiresAtUnixSeconds * 1000).toISOString()}>
          {formatExpiryDisplay(expiresAtUnixSeconds)}
        </time>
      </p>
    </section>
  );
}
