#!/usr/bin/env bun
/**
 * OpenDocs CLI entry point. Plain argv switch, no CLI framework.
 */
import pkg from '../package.json' with { type: 'json' };
import { login } from './commands/login';
import { logout } from './commands/logout';
import { toWebp } from './compress';

const USAGE = `opendocs ${pkg.version}

Usage:
  opendocs login --key <key>   Save an API key for this machine
  opendocs logout              Remove the stored API key
  opendocs --version           Print the CLI version`;

/** Hidden command used by CI to smoke-test each compiled binary. */
async function smokeEncode(path: string | undefined): Promise<number> {
  if (!path) {
    process.stderr.write('error: smoke-encode requires a file path\n');
    return 1;
  }
  try {
    const input = await Bun.file(path).bytes();
    const output = await toWebp(input);
    process.stdout.write(`ok ${output.length}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    return 1;
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case '--version':
    case '-v':
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    case 'login':
      return await login(rest);
    case 'logout':
      return await logout(rest);
    case 'smoke-encode':
      return await smokeEncode(rest[0]);
    default:
      process.stdout.write(`${USAGE}\n`);
      return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
