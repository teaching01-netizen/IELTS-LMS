import crypto from 'k6/crypto';

const sessions = new Map();

// Each virtual browser retains its opaque capability across retries. Tests
// simulating a transfer explicitly share it with the target browser.
export function practiceEntrySession(scheduleId, student) {
  const key = JSON.stringify([scheduleId, student.wcode, student.email.toLowerCase()]);
  if (!sessions.has(key)) {
    const bytes = new Uint8Array(crypto.randomBytes(32));
    sessions.set(key, Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
  }
  return sessions.get(key);
}
