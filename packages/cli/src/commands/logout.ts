/**
 * `opendocs logout` - remove the stored API key. Idempotent: exits 0 whether or
 * not a credentials file was there.
 */
import { credentialsPath, deleteCredentials } from '../config';

export interface LogoutDeps {
  credentialsFile?: string;
  deleteCredentials?: (file: string) => Promise<boolean>;
  stdout?: (line: string) => void;
}

/**
 * Run the logout command.
 *
 * @returns The process exit code (always 0).
 */
export async function logout(
  _argv: string[] = [],
  deps: LogoutDeps = {}
): Promise<number> {
  const out = deps.stdout ?? ((line) => process.stdout.write(line));
  const remove = deps.deleteCredentials ?? deleteCredentials;
  const file = deps.credentialsFile ?? credentialsPath();

  const deleted = await remove(file);
  out(deleted ? 'Logged out\n' : 'Not logged in\n');
  return 0;
}
