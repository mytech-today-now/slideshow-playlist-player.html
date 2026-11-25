import { createHash, randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('base64url');
const sha256 = createHash('sha256').update(key, 'utf8').digest('hex');

process.stdout.write('One-time Blend Profile Sync admin setup\n');
process.stdout.write('Admin key. Store this in a password manager. Do not paste it into chat or source files.\n');
process.stdout.write(`${key}\n`);
process.stdout.write('Set BLEND_PROFILE_SYNC_ADMIN_KEY_SHA256 in Render to this SHA-256 value:\n');
process.stdout.write(`${sha256}\n`);
