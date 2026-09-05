import { useState } from "react";

import type { ProviderKind } from "./types";

export function useSyncFormState() {
  const [provider, setProvider] = useState<ProviderKind>("webdav");
  const [resourceUrl, setResourceUrl] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("");
  const [objectKey, setObjectKey] = useState("");
  const [pathStyle, setPathStyle] = useState(false);
  const [username, setUsername] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [gatewayVaultId, setGatewayVaultId] = useState<string>(() =>
    globalThis.crypto.randomUUID(),
  );
  const [gatewayToken, setGatewayToken] = useState("");
  const [masterPassword, setMasterPassword] = useState("");

  const clearSecrets = () => {
    setWebdavPassword("");
    setSecretAccessKey("");
    setSessionToken("");
    setGatewayToken("");
    setMasterPassword("");
  };

  return {
    provider,
    resourceUrl,
    endpoint,
    region,
    bucket,
    objectKey,
    pathStyle,
    username,
    webdavPassword,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    gatewayUrl,
    gatewayVaultId,
    gatewayToken,
    masterPassword,
    setProvider,
    setResourceUrl,
    setEndpoint,
    setRegion,
    setBucket,
    setObjectKey,
    setPathStyle,
    setUsername,
    setWebdavPassword,
    setAccessKeyId,
    setSecretAccessKey,
    setSessionToken,
    setGatewayUrl,
    setGatewayVaultId,
    setGatewayToken,
    resetGatewayVaultId: () => {
      setGatewayVaultId(globalThis.crypto.randomUUID());
    },
    setMasterPassword,
    clearSecrets,
  };
}
