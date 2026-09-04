import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const auditArgs = ['audit', '--omit=dev', '--omit=optional', '--audit-level=high'];
const maximumAttempts = 3;
const attemptTimeoutMs = 60_000;
const transientAuditFailure = /(?:audit endpoint returned an error|503 Service Unavailable|E503|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)/i;

const pause = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...auditArgs], { encoding: 'utf8', timeout: attemptTimeoutMs })
    : spawnSync(npmCommand, auditArgs, { encoding: 'utf8', timeout: attemptTimeoutMs });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);

  if (result.status === 0) {
    process.exit(0);
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.code ?? ''}\n${result.error?.message ?? ''}`;
  const mayRetry = attempt < maximumAttempts && transientAuditFailure.test(output);
  if (!mayRetry) {
    process.exit(result.status ?? 1);
  }

  const delayMs = attempt * 10_000;
  console.warn(`npm audit service is temporarily unavailable; retrying in ${delayMs / 1_000}s (${attempt + 1}/${maximumAttempts}).`);
  await pause(delayMs);
}
