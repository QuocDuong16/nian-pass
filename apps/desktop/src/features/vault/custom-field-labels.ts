export function fieldLabel(name: string): string {
  return name.trim() === "" ? "Unnamed custom field" : name;
}

export function fieldActionLabel(
  action: "Edit" | "Delete",
  name: string,
): string {
  return `${action} ${name.trim() === "" ? "unnamed custom field" : name}`;
}

export function requireLoaded(value: string | null): string {
  if (value === null) throw new Error("Custom field value was not loaded");
  return value;
}
