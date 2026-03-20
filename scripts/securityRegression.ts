import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import express from 'express';
import db from '../src/server/db/index.js';
import apiRouter from '../src/server/routes/api.js';
import { getHydratedPackWithQuestions, listHydratedPacks } from '../src/server/services/materialIntel.js';
import { createTeacherSession, readTeacherSession } from '../src/server/services/demoAuth.js';
import { isAllowedBrowserOrigin } from '../src/server/services/requestGuards.js';
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

function makeTeacherRequest(token: string) {
  return {
    headers: {
      authorization: `Bearer ${token}`,
    },
  } as any;
}

async function createRegressionServer() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use('/api', apiRouter);

  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind regression server');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function run() {
  const createdPackIds: number[] = [];
  const createdTeacherIds: number[] = [];
  const createdSessionIds: number[] = [];
  const createdParticipantIds: number[] = [];
  const createdMasteryIds: number[] = [];
  const createdPracticeIds: number[] = [];
  let regressionServer: Awaited<ReturnType<typeof createRegressionServer>> | null = null;

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
    const implicitPrivatePack = db.prepare(`
      INSERT INTO quiz_packs (teacher_id, title, source_text, source_excerpt, source_language, source_word_count)
      VALUES (?, ?, 'implicit private source', 'implicit private excerpt', 'English', 3)
    `).run(Number(teacherOne.lastInsertRowid), `${marker}-implicit-private-pack`);
    const publicPack = db.prepare(`
      INSERT INTO quiz_packs (teacher_id, is_public, title, source_text, source_excerpt, source_language, source_word_count)
      VALUES (?, 1, ?, 'public source', 'public excerpt', 'English', 2)
    `).run(Number(teacherTwo.lastInsertRowid), `${marker}-public-pack`);
    createdPackIds.push(
      Number(privatePack.lastInsertRowid),
      Number(implicitPrivatePack.lastInsertRowid),
      Number(publicPack.lastInsertRowid),
    );

    const ownerVisiblePacks = await listHydratedPacks({ teacherUserId: Number(teacherOne.lastInsertRowid) });
    const ownerVisibleIds = new Set(ownerVisiblePacks.map((pack: any) => Number(pack.id)));
    assert.equal(ownerVisiblePacks.length, 2, 'owner pack listing should only return the owner packs');
    assert(ownerVisibleIds.has(Number(privatePack.lastInsertRowid)), 'explicit private pack must remain visible to its owner');
    assert(ownerVisibleIds.has(Number(implicitPrivatePack.lastInsertRowid)), 'packs should default to private for their owner');

    const publicVisiblePacks = await listHydratedPacks({ publicOnly: true });
    const publicVisibleIds = new Set(publicVisiblePacks.map((pack: any) => Number(pack.id)));
    assert(publicVisibleIds.has(Number(publicPack.lastInsertRowid)), 'public pack must be visible anonymously');
    assert(!publicVisibleIds.has(Number(privatePack.lastInsertRowid)), 'private pack must not be visible anonymously');
    assert(!publicVisibleIds.has(Number(implicitPrivatePack.lastInsertRowid)), 'packs must stay private unless explicitly shared');

    const deniedPack = await getHydratedPackWithQuestions(Number(privatePack.lastInsertRowid), {
      teacherUserId: Number(teacherTwo.lastInsertRowid),
      allowPublic: true,
    });
    assert.equal(deniedPack, null, 'another teacher must not be able to fetch a private pack');

    const hostedSession = db.prepare(`
      INSERT INTO sessions (quiz_pack_id, pin, status, game_type, team_count, mode_config_json)
      VALUES (?, ?, 'LOBBY', 'classic_quiz', 0, '{}')
    `).run(Number(privatePack.lastInsertRowid), '812345');
    createdSessionIds.push(Number(hostedSession.lastInsertRowid));

    const hostedParticipant = db.prepare(`
      INSERT INTO participants (session_id, identity_key, nickname, seat_index)
      VALUES (?, ?, ?, 1)
    `).run(Number(hostedSession.lastInsertRowid), `${marker}-hosted-student`, `${marker} Student`);
    createdParticipantIds.push(Number(hostedParticipant.lastInsertRowid));

    regressionServer = await createRegressionServer();
    const ownerTeacherSession = createTeacherSession({
      email: `${marker}-teacher-1@example.com`,
      provider: 'password',
    });
    const teacherHeaders = {
      authorization: `Bearer ${ownerTeacherSession.token}`,
    };

    const teacherPackResponse = await fetch(`${regressionServer.baseUrl}/api/teacher/packs/${Number(privatePack.lastInsertRowid)}`, {
      headers: teacherHeaders,
    });
    assert.equal(teacherPackResponse.status, 200, 'teacher-owned pack detail route must return private pack');
    const teacherPackPayload = await teacherPackResponse.json();
    assert.equal(Number(teacherPackPayload.id), Number(privatePack.lastInsertRowid));

    const teacherSessionResponse = await fetch(`${regressionServer.baseUrl}/api/teacher/sessions/pin/812345`, {
      headers: teacherHeaders,
    });
    assert.equal(teacherSessionResponse.status, 200, 'teacher-owned session by PIN route must return the teacher session');
    const teacherSessionPayload = await teacherSessionResponse.json();
    assert.equal(Number(teacherSessionPayload.id), Number(hostedSession.lastInsertRowid));

    const teacherParticipantsResponse = await fetch(`${regressionServer.baseUrl}/api/teacher/sessions/pin/812345/participants`, {
      headers: teacherHeaders,
    });
    assert.equal(teacherParticipantsResponse.status, 200, 'teacher-owned session roster route must return participants');
    const teacherParticipantsPayload = await teacherParticipantsResponse.json();
    assert.equal(Array.isArray(teacherParticipantsPayload.participants), true);
    assert.equal(teacherParticipantsPayload.participants.length, 1);

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

    const teacherSession = createTeacherSession({
      email: `${marker}-google@example.com`,
      provider: 'google',
    });
    const parsedTeacherSession = readTeacherSession(makeTeacherRequest(teacherSession.token));
    assert(parsedTeacherSession, 'teacher bearer session should round-trip');
    assert.equal(parsedTeacherSession?.email, `${marker}-google@example.com`);
    assert.equal(parsedTeacherSession?.provider, 'google');

    assert.equal(isAllowedBrowserOrigin('https://quizzi-ivory.vercel.app'), true, 'primary Vercel origin must be trusted');
    assert.equal(isAllowedBrowserOrigin('https://quizzi-staging-123.vercel.app'), true, 'Quizzi Vercel preview origins must be trusted');
    assert.equal(isAllowedBrowserOrigin('https://attacker.example.com'), false, 'untrusted origins must remain blocked');

    console.log('security regression checks passed');
  } finally {
    await regressionServer?.close().catch(() => {});
    if (createdPracticeIds.length) {
      db.prepare(`DELETE FROM practice_attempts WHERE id IN (${createdPracticeIds.map(() => '?').join(', ')})`).run(...createdPracticeIds);
    }
    if (createdMasteryIds.length) {
      db.prepare(`DELETE FROM mastery WHERE id IN (${createdMasteryIds.map(() => '?').join(', ')})`).run(...createdMasteryIds);
    }
    if (createdParticipantIds.length) {
      db.prepare(`DELETE FROM participants WHERE id IN (${createdParticipantIds.map(() => '?').join(', ')})`).run(...createdParticipantIds);
    }
    if (createdSessionIds.length) {
      db.prepare(`DELETE FROM sessions WHERE id IN (${createdSessionIds.map(() => '?').join(', ')})`).run(...createdSessionIds);
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
