import { spawnSync } from 'node:child_process';

const required = ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
for (const key of required) {
  if (!process.env[key] || !String(process.env[key]).trim()) {
    console.error(`Missing required build variable: ${key}`);
    process.exit(1);
  }
}

const run = (cmd, args, input) => {
  const result = spawnSync(cmd, args, {
    stdio: ['pipe', 'inherit', 'inherit'],
    input,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run('npx', ['wrangler', 'secret', 'put', 'GITHUB_OAUTH_CLIENT_ID'], `${process.env.GITHUB_OAUTH_CLIENT_ID}\n`);
run('npx', ['wrangler', 'secret', 'put', 'GITHUB_OAUTH_CLIENT_SECRET'], `${process.env.GITHUB_OAUTH_CLIENT_SECRET}\n`);
run('npx', ['wrangler', 'deploy']);