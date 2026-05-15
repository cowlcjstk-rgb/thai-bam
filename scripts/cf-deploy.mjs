import { spawnSync } from 'node:child_process';

const hasOauthId = Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && String(process.env.GITHUB_OAUTH_CLIENT_ID).trim());
const hasOauthSecret = Boolean(process.env.GITHUB_OAUTH_CLIENT_SECRET && String(process.env.GITHUB_OAUTH_CLIENT_SECRET).trim());
const cmsToken = String(process.env.GITHUB_CMS_TOKEN || process.env.GITHUB_PAT || process.env.GITHUB_ACCESS_TOKEN || '').trim();

if (!cmsToken && !(hasOauthId && hasOauthSecret)) {
  console.error('Missing deploy auth variables.');
  console.error('Use either: GITHUB_CMS_TOKEN');
  console.error('or both: GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET');
  process.exit(1);
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

if (cmsToken) {
  run('npx', ['wrangler', 'secret', 'put', 'GITHUB_CMS_TOKEN'], `${cmsToken}\n`);
}

if (hasOauthId && hasOauthSecret) {
  run('npx', ['wrangler', 'secret', 'put', 'GITHUB_OAUTH_CLIENT_ID'], `${process.env.GITHUB_OAUTH_CLIENT_ID}\n`);
  run('npx', ['wrangler', 'secret', 'put', 'GITHUB_OAUTH_CLIENT_SECRET'], `${process.env.GITHUB_OAUTH_CLIENT_SECRET}\n`);
}

run('npx', ['wrangler', 'deploy']);
