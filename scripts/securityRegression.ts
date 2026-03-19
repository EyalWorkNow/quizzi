import assert from 'node:assert/strict';
import db from '../src/server/db/index.js';
import { getHydratedPackWithQuestions, listHydratedPacks } from '../src/server/services/materialIntel.js';
import {
  buildLegacyStudentIdentityKey,
  createParticipantAccessToken,
  readParticipantAccessToken,
} from '../src/server/services/studentIdentity.js';

const marker = `security-regression-${Date.now()}`;

function makeMockRequest(token: string) {
  return {
    headers: {
      'x-quizzi-participant-token': token,
    },
  } as any;
}

async function run() {
  const createdPackIds: number[] = [];
  const createdTeacherIds: number[] = [];
  const createdParticipantIds: number[] = [];
  const createdMasteryIds: number[] = [];
  const createdPracticeIds: number[] = [];

  try {
    const teacherOne = db.prepare(`
      INSERT INTO users (email, password_hash, auth_provider, updated_at)
      VALUES (?, ?, 'password', CURRENT_TIMESTAMP)
    `).run(`${marker}-teacher-1@example.com`, 'hash');
    const teacherTwo = db.prepare(`
      INSERT INTO users (email, password_hash, auth_provider, updated_at)
      VALUES (?, ?, 'password', CURRENT_TIMESTAMP)
    `).run(`${marker}-teacher-2@example.com`, 'hash');
    createdTeacherIds.push(Number(teacherOne.lastInsertRowid), Number(teacherTwo.lastInsertRowid));

    const privatePack = db.prepare(`
      INSERT INTO quiz_packs (teacher_id, is_public, title, source_text, source_excerpt, source_language, source_word_count)
      VALUES (?, 0, ?, 'private source', 'private excerpt', 'English', 2)
    `).run(Number(teacherOne.lastInsertRowid), `${marker}-private-pack`);
    const publicPack = db.prepare(`
      INSERT INTO quiz_packs (teacher_id, is_public, title, source_text, source_excerpt, source_language, source_word_count)
      VALUES (?, 1, ?, 'public source', 'public excerpt', 'English', 2)
    `).run(Number(teacherTwo.lastInsertRowid), `${marker}-public-pack`);
    createdPackIds.push(Number(privatePack.lastInsertRowid), Number(publicPack.lastInsertRowid));

    const ownerVisiblePacks = await listHydratedPacks({ teacherUserId: Number(teacherOne.lastInsertRowid) });
    assert.equal(ownerVisiblePacks.length, 1, 'owner pack listing should only return the owner pack');
    assert.equal(Number(ownerVisiblePacks[0]?.id || 0), Number(privatePack.lastInsertRowid));

    const publicVisiblePacks = await listHydratedPacks({ publicOnly: true });
    const publicVisibleIds = new Set(publicVisiblePacks.map((pack: any) => Number(pack.id)));
    assert(publicVisibleIds.has(Number(publicPack.lastInsertRowid)), 'public pack must be visible anonymously');
    assert(!publicVisibleIds.has(Number(privatePack.lastInsertRowid)), 'private pack must not be visible anonymously');

    const deniedPack = await getHydratedPackWithQuestions(Number(privatePack.lastInsertRowid), {
      teacherUserId: Number(teacherTwo.lastInsertRowid),
      allowPublic: true,
    });
    assert.equal(deniedPack, null, 'another teacher must not be able to fetch a private pack');

    const nickname = `[avatar_1.png] Shared Name ${marker}`;
    const identityOne = `${buildLegacyStudentIdentityKey(nickname)}-one`;
    const identityTwo = `${buildLegacyStudentIdentityKey(nickname)}-two`;

    const participantOne = db.prepare(`
      INSERT INTO participants (session_id, identity_key, nickname)
      VALUES (?, ?, ?)
    `).run(1, identityOne, nickname);
    const participantTwo = db.prepare(`
      INSERT INTO participants (session_id, identity_key, nickname)
      VALUES (?, ?, ?)
    `).run(2, identityTwo, nickname);
    createdParticipantIds.push(Number(participantOne.lastInsertRowid), Number(participantTwo.lastInsertRowid));

    const masteryOne = db.prepare(`
      INSERT INTO mastery (identity_key, nickname, tag, score)
      VALUES (?, ?, 'fractions', 91)
    `).run(identityOne, nickname);
    const masteryTwo = db.prepare(`
      INSERT INTO mastery (identity_key, nickname, tag, score)
      VALUES (?, ?, 'fractions', 24)
    `).run(identityTwo, nickname);
    createdMasteryIds.push(Number(masteryOne.lastInsertRowid), Number(masteryTwo.lastInsertRowid));

    const practiceOne = db.prepare(`
      INSERT INTO practice_attempts (identity_key, nickname, question_id, is_correct, response_ms)
      VALUES (?, ?, 101, 1, 2200)
    `).run(identityOne, nickname);
    const practiceTwo = db.prepare(`
      INSERT INTO practice_attempts (identity_key, nickname, question_id, is_correct, response_ms)
      VALUES (?, ?, 101, 0, 8700)
    `).run(identityTwo, nickname);
    createdPracticeIds.push(Number(practiceOne.lastInsertRowid), Number(practiceTwo.lastInsertRowid));

    const masteryRowsOne = db.prepare('SELECT score FROM mastery WHERE identity_key = ? AND tag = ?').all(identityOne, 'fractions') as any[];
    const masteryRowsTwo = db.prepare('SELECT score FROM mastery WHERE identity_key = ? AND tag = ?').all(identityTwo, 'fractions') as any[];
    assert.deepEqual(masteryRowsOne.map((row) => Number(row.score)), [91], 'identity-scoped mastery must stay isolated');
    assert.deepEqual(masteryRowsTwo.map((row) => Number(row.score)), [24], 'identity-scoped mastery must stay isolated');

    const { token } = createParticipantAccessToken({
      participantId: 44,
      sessionId: 55,
      identityKey: identityOne,
      nickname,
    });
    const parsedToken = readParticipantAccessToken(makeMockRequest(token));
    assert(parsedToken, 'participant access token should round-trip');
    assert.equal(parsedToken?.participantId, 44);
    assert.equal(parsedToken?.sessionId, 55);
    assert.equal(parsedToken?.identityKey, identityOne);

    const tampered = `${token.slice(0, -1)}${token.slice(-1) === 'a' ? 'b' : 'a'}`;
    assert.equal(readParticipantAccessToken(makeMockRequest(tampered)), null, 'tampered participant token must fail verification');

    console.log('security regression checks passed');
  } finally {
    if (createdPracticeIds.length) {
      db.prepare(`DELETE FROM practice_attempts WHERE id IN (${createdPracticeIds.map(() => '?').join(', ')})`).run(...createdPracticeIds);
    }
    if (createdMasteryIds.length) {
      db.prepare(`DELETE FROM mastery WHERE id IN (${createdMasteryIds.map(() => '?').join(', ')})`).run(...createdMasteryIds);
    }
    if (createdParticipantIds.length) {
      db.prepare(`DELETE FROM participants WHERE id IN (${createdParticipantIds.map(() => '?').join(', ')})`).run(...createdParticipantIds);
    }
    if (createdPackIds.length) {
      db.prepare(`DELETE FROM quiz_packs WHERE id IN (${createdPackIds.map(() => '?').join(', ')})`).run(...createdPackIds);
    }
    if (createdTeacherIds.length) {
      db.prepare(`DELETE FROM users WHERE id IN (${createdTeacherIds.map(() => '?').join(', ')})`).run(...createdTeacherIds);
    }
  }
}

run().catch((error) => {
  console.error('security regression checks failed');
  console.error(error);
  process.exit(1);
});
