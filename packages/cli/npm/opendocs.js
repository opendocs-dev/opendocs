#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Map a platform/arch pair to its optionalDependency package name.
 * Returns null for anything not built by the release workflow.
 */
export function platformPackage(platform, arch) {
  const known = {
    'darwin-arm64': 'opendocs-cli-darwin-arm64',
    'darwin-x64': 'opendocs-cli-darwin-x64',
    'linux-x64': 'opendocs-cli-linux-x64',
    'linux-arm64': 'opendocs-cli-linux-arm64',
    'win32-x64': 'opendocs-cli-win32-x64',
  };
  return known[`${platform}-${arch}`] ?? null;
}

function main() {
  const platform = process.platform;
  const arch = process.arch;
  const pkg = platformPackage(platform, arch);

  const fail = () => {
    process.stderr.write(
      `opendocs: no binary for ${platform}-${arch}; expected package ${pkg ?? '<unknown>'} (reinstall without --no-optional)\n`
    );
    process.exit(1);
  };

  if (!pkg) {
    fail();
    return;
  }

  const require = createRequire(import.meta.url);
  const binName = platform === 'win32' ? 'opendocs.exe' : 'opendocs';
  let bin;
  try {
    bin = require.resolve(`${pkg}/bin/${binName}`);
  } catch {
    fail();
    return;
  }

  const result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' });

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  process.exit(result.status ?? 1);
}

// npm runs this through a symlink in node_modules/.bin (a .cmd shim on Windows), so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}
