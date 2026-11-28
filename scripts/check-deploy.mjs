import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const expectedSha = process.env.EXPECTED_COMMIT_SHA;
const previousRevision = process.env.PREVIOUS_REVISION || '';
const service = process.env.CLOUD_RUN_SERVICE || 'over-heard';
const region = process.env.CLOUD_RUN_REGION || 'us-east1';
const project = process.env.CLOUD_RUN_PROJECT || 'loyal-rookery-403218';

assert.ok(expectedSha, 'EXPECTED_COMMIT_SHA must be set');

const raw = execFileSync(
  'gcloud',
  ['run', 'services', 'describe', service, '--region', region, '--project', project, '--format', 'json'],
  { encoding: 'utf8' }
);

const description = JSON.parse(raw);
const revision = description?.status?.latestReadyRevisionName;
const serviceUrl = description?.status?.url;
const serviceCommit = description?.metadata?.labels?.['commit-sha'];
const templateCommit = description?.spec?.template?.metadata?.labels?.['commit-sha'];

assert.ok(revision, 'Cloud Run service did not report status.latestReadyRevisionName');
assert.ok(serviceUrl, 'Cloud Run service did not report status.url');
assert.equal(serviceCommit, expectedSha, `service commit-sha label ${serviceCommit} != ${expectedSha}`);
assert.equal(templateCommit, expectedSha, `template commit-sha label ${templateCommit} != ${expectedSha}`);

console.log(`Serving revision: ${revision}`);
console.log(`Commit SHA:       ${expectedSha}`);
console.log(`Service URL:      ${serviceUrl}`);
if (previousRevision && previousRevision !== revision) {
  console.log(
    `Rollback command: gcloud run services update-traffic ${service} --region ${region} --project ${project} --to-revisions=${previousRevision}=100`
  );
}

const configRes = await fetch(`${serviceUrl}/api/config`);
assert.equal(configRes.status, 200, `/api/config returned ${configRes.status}`);
const config = await configRes.json();
assert.ok(typeof config.mtProvider === 'string' && config.mtProvider.length > 0, 'missing mtProvider in /api/config');

const swRes = await fetch(`${serviceUrl}/sw.js`);
assert.equal(swRes.status, 200, `/sw.js returned ${swRes.status}`);
assert.equal(swRes.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
assert.match(await swRes.text(), /self\.addEventListener/);

const indexRes = await fetch(`${serviceUrl}/`);
assert.equal(indexRes.status, 200, `/ returned ${indexRes.status}`);
assert.equal(indexRes.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
const indexHtml = await indexRes.text();
const assetMatch = indexHtml.match(/\/assets\/[^"'\s>]+\.(?:js|css)/);
assert.ok(assetMatch, 'could not locate a built /assets/ bundle URL in /');

const assetUrl = `${serviceUrl}${assetMatch[0]}`;
const assetRes = await fetch(assetUrl);
assert.equal(assetRes.status, 200, `${assetUrl} returned ${assetRes.status}`);
assert.match(assetRes.headers.get('cache-control') || '', /immutable/);
assert.ok((await assetRes.text()).length > 0, `empty asset response from ${assetUrl}`);

console.log(`Verified live /api/config, /sw.js, and ${assetMatch[0]} on ${serviceUrl}.`);
