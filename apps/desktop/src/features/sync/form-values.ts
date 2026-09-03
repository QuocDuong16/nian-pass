import type { ProviderCredentials, SyncProfileTarget } from "../../lib/sync";
import type { ProviderKind } from "./types";

interface SyncFormValues {
  provider: ProviderKind;
  resourceUrl: string;
  endpoint: string;
  region: string;
  bucket: string;
  objectKey: string;
  pathStyle: boolean;
  username: string;
  webdavPassword: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export function projectSyncForm(values: SyncFormValues): {
  target: SyncProfileTarget;
  credentials: ProviderCredentials;
  providerConfigComplete: boolean;
  credentialsComplete: boolean;
} {
  if (values.provider === "webdav") {
    return {
      target: {
        provider: values.provider,
        resourceUrl: values.resourceUrl.trim(),
      },
      credentials: {
        webdav: {
          username: values.username,
          password: values.webdavPassword,
        },
      },
      providerConfigComplete: values.resourceUrl.trim() !== "",
      credentialsComplete:
        values.username.trim() !== "" && values.webdavPassword !== "",
    };
  }
  return {
    target: {
      provider: values.provider,
      endpoint: values.endpoint.trim() === "" ? null : values.endpoint.trim(),
      region: values.region.trim(),
      bucket: values.bucket.trim(),
      objectKey: values.objectKey.trim(),
      pathStyle: values.pathStyle,
    },
    credentials: {
      s3: {
        accessKeyId: values.accessKeyId,
        secretAccessKey: values.secretAccessKey,
        ...(values.sessionToken === ""
          ? {}
          : { sessionToken: values.sessionToken }),
      },
    },
    providerConfigComplete:
      values.region.trim() !== "" &&
      values.bucket.trim() !== "" &&
      values.objectKey.trim() !== "",
    credentialsComplete:
      values.accessKeyId.trim() !== "" && values.secretAccessKey !== "",
  };
}
