import { hashSignal } from "@worldcoin/idkit-core/hashing";

const defaultBridgeUrl = "https://bridge.worldcoin.org";

type AbiSignal = {
  types: string[];
  values: unknown[];
};

type BridgeConfig = {
  app_id: string;
  action: string;
  signal?: string | AbiSignal;
  verification_level?: string;
  bridge_url?: string;
};

function bytesToBase64(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const parts = hex.match(/.{2}/gu)!;
  const bytes = new Uint8Array(new ArrayBuffer(parts.length));
  parts.forEach((part, index) => {
    bytes[index] = parseInt(part, 16);
  });
  return bytes;
}

function credentialTypes(verificationLevel = "orb") {
  if (verificationLevel === "device") return ["orb", "device"];
  if (verificationLevel === "document") return ["document", "secure_document", "orb"];
  if (verificationLevel === "secure_document") return ["secure_document", "orb"];
  return ["orb"];
}

function packAddress(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) {
    throw new Error("signal address is invalid");
  }
  return hexToBytes(value.slice(2));
}

function packUint256(value: unknown) {
  const hex = BigInt(String(value)).toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function packSignal(signal: AbiSignal) {
  const chunks = signal.types.map((type, index) => {
    if (type === "address") return packAddress(signal.values[index]);
    if (type === "uint256") return packUint256(signal.values[index]);
    throw new Error(`unsupported signal type: ${type}`);
  });
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const packed = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    packed.set(chunk, offset);
    offset += chunk.length;
  }
  return packed;
}

function signalDigest(signal: BridgeConfig["signal"]) {
  if (!signal) return hashSignal("");
  if (typeof signal === "string") return hashSignal(signal);
  return hashSignal(packSignal(signal));
}

async function createKey() {
  const iv = new Uint8Array(new ArrayBuffer(12));
  window.crypto.getRandomValues(iv);
  return {
    iv,
    key: await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]),
  };
}

async function exportKey(key: CryptoKey) {
  return bytesToBase64(await window.crypto.subtle.exportKey("raw", key));
}

async function encryptRequest(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, request: string) {
  const payload = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(request),
  );
  return {
    iv: bytesToBase64(iv),
    payload: bytesToBase64(payload),
  };
}

async function decryptResponse(key: CryptoKey, iv: string, payload: string) {
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(payload),
  );
  return new TextDecoder().decode(decrypted);
}

export async function createLegacyWorldBridgeClient(config: BridgeConfig) {
  const bridgeUrl = config.bridge_url || defaultBridgeUrl;
  const { key, iv } = await createKey();
  const verificationLevel = config.verification_level || "orb";
  const response = await fetch(new URL("/request", bridgeUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      await encryptRequest(
        key,
        iv,
        JSON.stringify({
          app_id: config.app_id,
          action: config.action,
          signal: signalDigest(config.signal),
          credential_types: credentialTypes(verificationLevel),
          verification_level: verificationLevel,
        }),
      ),
    ),
  });
  if (!response.ok) throw new Error("Failed to create World App verification request");
  const { request_id: requestId } = await response.json();
  const bridgeParam = bridgeUrl === defaultBridgeUrl ? "" : `&b=${encodeURIComponent(bridgeUrl)}`;
  return {
    connectorURI: `https://world.org/verify?t=wld&i=${requestId}&k=${encodeURIComponent(await exportKey(key))}${bridgeParam}`,
    async pollForUpdates() {
      const pollResponse = await fetch(new URL(`/response/${requestId}`, bridgeUrl));
      if (!pollResponse.ok) return { errorCode: "connection_failed", result: null };
      const body = await pollResponse.json();
      if (!body.response) return { errorCode: null, result: null };
      const result = JSON.parse(await decryptResponse(key, body.response.iv, body.response.payload));
      if ("error_code" in result) return { errorCode: result.error_code, result: null };
      return { errorCode: null, result };
    },
  };
}
