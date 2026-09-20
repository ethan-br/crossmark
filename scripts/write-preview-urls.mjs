import { appendFile, writeFile } from 'node:fs/promises';

const cloud = (process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/i.test(cloud)) {
  console.error(`Unexpected CONVEX_URL from convex deploy --cmd: ${cloud || '(empty)'}`);
  process.exit(1);
}

const site = cloud.replace(/\.convex\.cloud$/i, '.convex.site');
await writeFile('convex-preview.env', `VITE_CONVEX_URL=${cloud}\nVITE_CONVEX_SITE_URL=${site}\n`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `convex_url=${cloud}\nconvex_site_url=${site}\n`);
}

console.log(`Preview functions: ${cloud}`);
console.log(`Preview HTTP: ${site}`);
