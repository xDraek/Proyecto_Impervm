import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROTECTION } from '../src/game/data.js';
import { makeWorld, sendAndArrive } from './world.js';

// Protección contra el acoso: escudo tras librarse de un bloqueo o una ocupación, y límite de
// ataques diarios contra el mismo jugador.

const HOUR = 3_600_000;

/** Aníbal acaba de librarse de un bloqueo de Lucio. */
async function freed() {
  const env = await makeWorld();
  const [A, B, C] = env.players;
  Object.assign(A.state.units, { trirreme: 10, dromon: 10, hoplita: 150, mercante: 4 });
  const m = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 6 });
  A.recall(m.id);
  return { env, A, B, C };
}

test('tras librarse de un bloqueo nadie puede bloquearla ni invadirla', async () => {
  const { A, B, C } = await freed();
  assert.ok(B.shield(), 'tiene protección');
  assert.ok(A.island(B.state.home).shield, 'los demás la ven protegida');
  Object.assign(C.state.units, { trirreme: 5, dromon: 5, hoplita: 50 });
  assert.match(C.planMission('bloquear', B.state.home, { trirreme: 5 }).reason, /acaba de librarse/);
  assert.match(C.planMission('invadir', B.state.home, { dromon: 5, hoplita: 50 }).reason, /acaba de librarse/);
  // Los ataques normales sí
  assert.equal(C.planMission('atacar', B.state.home, { dromon: 5, hoplita: 50 }).ok, true);
});

test('la protección dura lo que dice y luego se puede volver a bloquear', async () => {
  const { env, B, C } = await freed();
  C.state.units.trirreme = 5;
  env.advance((PROTECTION.shieldHours + 0.1) * HOUR);
  assert.equal(B.shield(), null);
  assert.equal(C.planMission('bloquear', B.state.home, { trirreme: 5 }).ok, true);
});

test('quien bloquea o invade pierde su propia protección', async () => {
  const { A, B } = await freed();
  B.state.units.trirreme = 3;
  assert.ok(B.shield());
  assert.equal(B.sendMission('bloquear', A.state.home, { trirreme: 3 }).ok, true);
  assert.equal(B.shield(), null);
});

test('una invasión que llega a una ciudad recién liberada saquea pero no se queda', async () => {
  const env = await makeWorld();
  const [A, B, C] = env.players;
  Object.assign(A.state.units, { trirreme: 6 });
  Object.assign(C.state.units, { dromon: 10, hoplita: 150, mercante: 4 });
  // Pericles sale hacia la ciudad antes de que Aníbal quede protegido
  const block = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 6 });
  assert.equal(C.sendMission('invadir', B.state.home, { dromon: 10, hoplita: 150, mercante: 4 }, null, {}).ok, true);
  const inv = C.state.missions.at(-1);
  A.recall(block.id);
  assert.ok(B.shield());
  env.until(inv.arrive);
  assert.equal(B.state.occupied, null);
  assert.notEqual(inv.phase, 'estacionada');
  assert.match(C.state.reports[0].text ?? '', /está protegida/);
});

test(`como mucho ${PROTECTION.attacksPerDay} ataques al mismo jugador al día`, async () => {
  const env = await makeWorld();
  const [A, B, C] = env.players;
  A.state.units.trirreme = 50;
  B.state.units.lancero = 0;
  for (let i = 0; i < PROTECTION.attacksPerDay; i++) assert.equal(A.sendMission('atacar', B.state.home, { trirreme: 1 }, null, {}).ok, true);
  assert.match(A.planMission('atacar', B.state.home, { trirreme: 1 }).reason, /Ya has atacado/);
  assert.equal(A.attacksOn(B.userId), PROTECTION.attacksPerDay);
  // A otro jugador sí
  assert.equal(A.planMission('atacar', C.state.home, { trirreme: 1 }).ok, true);
  // Pasado un día vuelve a poder
  env.advance(24.1 * HOUR);
  assert.equal(A.attacksOn(B.userId), 0);
  assert.equal(A.planMission('atacar', B.state.home, { trirreme: 1 }).ok, true);
});

test('entre alianzas en guerra no hay límite de ataques', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  env.world.createAlliance(A.userId, 'Roma', 'ROM');
  env.world.createAlliance(B.userId, 'Cartago', 'CAR');
  env.world.diplomacy(A.userId, env.world.allianceOf(B.userId).id, 'guerra');
  assert.equal(env.world.relation(A.userId, B.userId), 'guerra');
  A.state.units.trirreme = 50;
  for (let i = 0; i < PROTECTION.attacksPerDay + 2; i++) assert.equal(A.sendMission('atacar', B.state.home, { trirreme: 1 }, null, {}).ok, true);
});
