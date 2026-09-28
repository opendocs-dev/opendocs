/**
 * Credential storage for the OpenDocs CLI.
 *
 * The API key lives in a single plain-text file, written atomically with mode
 * 0o600 so it is never world-readable and never left half-written.
 */
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Directory name used under the platform's per-user config root. */
const APP_DIR = 'opendocs';
const FILE_NAME = 'credentials';

/**
 * Resolve the path of the credentials file for a platform.
 *
 * Arguments are injectable so tests can cover every platform on any host.
 *
 * @param platform A `process.platform` value.
 * @param env The environment to read XDG_CONFIG_HOME / APPDATA from.
 * @param home The user's home directory.
 */
export function credentialsPath(
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir()
): string {
  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming');
    return path.win32.join(appData, APP_DIR, FILE_NAME);
  }
  const configHome = env.XDG_CONFIG_HOME ?? path.join(home, '.config');
  return path.join(configHome, APP_DIR, FILE_NAME);
}

/**
 * Write the API key to disk, replacing any existing key.
 *
 * The key goes to a temp file in the target directory first, then a rename puts
 * it in place: a reader either sees the old file or the new one, never a partial
 * write. If the rename fails the temp file is removed.
 *
 * @param key The API key to store.
 * @param file Target path; defaults to {@link credentialsPath}.
 */
export async function saveCredentials(
  key: string,
  file: string = credentialsPath()
): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const temp = path.join(dir, `.${FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temp, `${key}\n`, { mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Read the stored API key.
 *
 * @param file Source path; defaults to {@link credentialsPath}.
 * @returns The key, or null when there is no readable credentials file.
 */
export async function readCredentials(
  file: string = credentialsPath()
): Promise<string | null> {
  try {
    const key = (await Bun.file(file).text()).trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Remove the stored API key.
 *
 * @param file Target path; defaults to {@link credentialsPath}.
 * @returns True when a file was deleted, false when there was nothing to delete.
 */
export async function deleteCredentials(
  file: string = credentialsPath()
): Promise<boolean> {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    // Only "no file" means logged out; anything else (e.g. EACCES) must surface.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
