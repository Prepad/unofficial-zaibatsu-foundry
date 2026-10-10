import { xchacha20poly1305 } from "../vendor/noble-ciphers/chacha.js";
import { bytesToHex, hexToBytes, randomBytes } from "../vendor/noble-ciphers/utils.js";
import { serial } from "./runtime.mjs";

const aad = new TextEncoder().encode("zaibatsu-cyberspace-v1");
export function sealState(state, key) {
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(hexToBytes(key), nonce, aad).encrypt(new TextEncoder().encode(JSON.stringify(state)));
  return { version: 1, nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}
export function openState(box, key) {
  const plaintext = xchacha20poly1305(hexToBytes(key), hexToBytes(box.nonce), aad).decrypt(hexToBytes(box.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
async function getKey(create = false) {
  return serial("vault-key", async () => {
  if (!game.user.isGM) throw new Error("Закрытые данные киберпространства доступны ведущему.");
  let key = game.settings.get("zaibatsu", "cyberKey");
  if (!key && create) {
    for (const network of game.settings.get("zaibatsu", "networks") ?? []) {
      const document = await fromUuid(network.uuid);
      if (document?.getFlag("zaibatsu", "network")?.ciphertext) throw new Error("Импортируйте исходный ключ существующих сетей перед созданием новой.");
    }
    key = bytesToHex(randomBytes(32));
    await game.settings.set("zaibatsu", "cyberKey", key);
  }
  if (!/^[a-f\d]{64}$/i.test(key ?? "")) throw new Error("Импортируйте ключ киберпространства этого мира в настройках Zaibatsu на устройстве ведущего.");
  return key;
  });
}
export async function readNetwork(document) {
  const data = document.getFlag("zaibatsu", "network");
  if (!data) throw new Error("Документ сети не найден.");
  if (!game.user.isGM) throw new Error("Нужны права ведущего.");
  if (!data.ciphertext) return foundry.utils.deepClone(data); // Migration from development snapshots.
  try { return openState(data, await getKey()); }
  catch (error) { throw new Error(`Не удалось открыть сеть: нужен исходный ключ ведущего. ${error.message}`); }
}
export async function writeNetwork(document, state) {
  return document.setFlag("zaibatsu", "network", await encryptNetwork(state));
}
export async function encryptNetwork(state) { return sealState(state, await getKey(true)); }
