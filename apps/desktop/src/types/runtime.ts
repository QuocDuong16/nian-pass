export type RuntimePlatform = "desktop" | "android" | "ios";

interface RuntimeInfoBaseDto {
  version: string;
  commit: string;
}

export interface DesktopRuntimeInfoDto extends RuntimeInfoBaseDto {
  platform: "desktop";
  ordinarySaveSupported: boolean;
}

export interface MobileRuntimeInfoDto extends RuntimeInfoBaseDto {
  platform: "android" | "ios";
  ordinarySaveSupported?: never;
}

export type RuntimeInfoDto = DesktopRuntimeInfoDto | MobileRuntimeInfoDto;
