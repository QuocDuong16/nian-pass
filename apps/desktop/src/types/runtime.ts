export type RuntimePlatform = "desktop" | "android" | "ios";

interface RuntimeInfoBaseDto {
  version: string;
  commit: string;
}

interface DesktopRuntimeInfoDto extends RuntimeInfoBaseDto {
  platform: "desktop";
  ordinarySaveSupported: boolean;
}

interface MobileRuntimeInfoDto extends RuntimeInfoBaseDto {
  platform: "android" | "ios";
  ordinarySaveSupported?: never;
}

export type RuntimeInfoDto = DesktopRuntimeInfoDto | MobileRuntimeInfoDto;
