import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['install'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
