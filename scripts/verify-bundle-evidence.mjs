import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundleEvidence } from './lib/bundle-evidence.mjs';

export { verifyBundleEvidence };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/verify-bundle-evidence.mjs <dist-directory>');
    process.stdout.write(JSON.stringify(verifyBundleEvidence(process.argv[2])) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
