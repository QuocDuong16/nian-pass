export function formatExpiryInput(unixSeconds: number | null): string {
  if (unixSeconds === null) return "";
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(
    date.getMonth() + 1,
  )}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseExpiryInput(value: string): number | null {
  if (value.trim() === "") return null;
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export function isEntryExpired(
  unixSeconds: number,
  nowUnixSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return unixSeconds <= nowUnixSeconds;
}

export function formatExpiryDisplay(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (!Number.isFinite(date.getTime())) return "Invalid expiry";
  return date.toLocaleString();
}
