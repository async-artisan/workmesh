const enabled = process.env.WORKMESH_GITHUB_LIVE === '1';
if (!enabled) {
  console.log(JSON.stringify({ suite: 'github-live', status: 'SKIPPED', reason: 'WORKMESH_GITHUB_LIVE=1 and an independently authorized test repository are required' }));
  process.exit(0);
}
if (!process.env.WORKMESH_GITHUB_TEST_REPOSITORY) {
  console.error(JSON.stringify({ suite: 'github-live', status: 'BLOCKED', reason: 'WORKMESH_GITHUB_TEST_REPOSITORY is missing' }));
  process.exit(2);
}
console.error(JSON.stringify({ suite: 'github-live', status: 'BLOCKED', reason: 'Live adapter runner is not implemented; no GitHub request was made' }));
process.exit(2);
