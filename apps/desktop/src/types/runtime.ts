export type RuntimePlatform = "desktop" | "android" | "ios";

export interface RuntimeInfoDto {
  platform: RuntimePlatform;
  version: string;
  commit: string;
}
