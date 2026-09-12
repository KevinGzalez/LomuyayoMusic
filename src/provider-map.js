import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function createProviderMap(env = process.env) {
  const path = resolve(process.cwd(), env.PROVIDER_MAP_FILE || '.cache/provider-map.json');
  let data = {};
  let loaded = false;
  let saveChain = Promise.resolve();

  async function load() {
    if (loaded) return;
    await mkdir(dirname(path), { recursive: true });
    try {
      data = JSON.parse(await readFile(path, 'utf8')) || {};
    } catch {
      data = {};
    }
    loaded = true;
  }

  async function get(identityKey, providerName) {
    await load();
    return data[identityKey]?.[providerName] || null;
  }

  async function set(identityKey, providerName, value) {
    await load();
    data[identityKey] ||= {};
    data[identityKey][providerName] = {
      ...value,
      updatedAt: Date.now(),
    };
    saveChain = saveChain.then(() => writeFile(path, JSON.stringify(data, null, 2), 'utf8')).catch(() => {});
    await saveChain;
  }

  async function remove(identityKey, providerName) {
    await load();
    if (!data[identityKey]) return;
    if (providerName) delete data[identityKey][providerName];
    else delete data[identityKey];
    saveChain = saveChain.then(() => writeFile(path, JSON.stringify(data, null, 2), 'utf8')).catch(() => {});
    await saveChain;
  }

  return { get, set, remove };
}
