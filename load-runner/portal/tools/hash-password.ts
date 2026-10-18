import process from 'node:process';
import { hashPortalPassword } from '../auth';

const password = process.argv[2] ?? '';
if (!password) {
  process.stderr.write('usage: bun run portal:hash-password -- <password>\n');
  process.exit(1);
}
process.stdout.write(`${hashPortalPassword(password)}\n`);
