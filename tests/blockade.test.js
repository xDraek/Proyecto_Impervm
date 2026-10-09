import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock } from '../src/config.js';
import { BLOCKADE, PROTECTION } from '../src/game/data.js';
import { lastMission, makeWorld, sendAndArrive } from './world.js';

// Bloqueos de puerto: combate naval, puerto cerrado, fin por tiempo y romper el bloqueo.

const HOUR = 3_600_000;

test('bloquear un puerto sin defensa lo cierra', async () => {
  const env = await makeWorld();
  const [A, B, C] = env.players;
  A.state.units.trirreme = 20;
  C.state.units.mercante = 2;
  const m = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 10 });

  assert.equal(m.phase, 'estacionada');
  assert.equal(B.state.blockade?.by, A.userId);
  assert.equal(env.world.playerInfo(B.userId).port.kind, 'bloquear');
  // No zarpa nadie, no hay mercado y no entran transportes
  B.state.units.bote = 1;
  assert.match(B.planMission('explorar', A.state.home, { bote: 1 }).reason, /bloquea tu puerto/);
  assert.equal(B.trade('madera', 'oro', 100).ok, false);
  const t = sendAndArrive(env, C, 'transporte', B.state.home, { mercante: 1 }, {}, { madera: 300 });
  assert.match(C.state.reports[0].title, /Puerto cerrado/);
  assert.equal(t.cargo.madera, 300); // vuelve con la carga
  assert.ok(!B.state.reports.some((r) => r.kind === 'transporte'));
  // Nadie más puede bloquearlo a la vez
  C.state.units.trirreme = 5;
  assert.match(C.planMission('bloquear', B.state.home, { trirreme: 5 }).reason, /ya bloquea/);
});

test('para bloquear solo valen barcos de guerra', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  Object.assign(A.state.units, { trirreme: 5, mercante: 2, hoplita: 10 });
  assert.match(A.planMission('bloquear', B.state.home, { trirreme: 5, mercante: 1 }).reason, /solo barcos de guerra/);
  assert.match(A.planMission('bloquear', B.state.home, { trirreme: 5, hoplita: 4 }).reason, /solo barcos de guerra/);
  assert.equal(A.planMission('bloquear', B.state.home, { trirreme: 5 }).ok, true);
});

test('una flota defensora más fuerte rechaza el bloqueo', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  A.state.units.trirreme = 3;
  B.state.units.dromon = 15;
  const m = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 3 });
  assert.equal(B.state.blockade, null);
  assert.notEqual(m.phase, 'estacionada');
});

test('el bloqueo se levanta solo al acabar su tiempo y deja la ciudad protegida', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  A.state.units.trirreme = 10;
  const m = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 10 });
  assert.ok(B.state.blockade);
  env.until(m.until);
  assert.equal(B.state.blockade, null);
  assert.equal(m.phase, 'vuelta');
  assert.ok(B.shield() > clock.now() + (PROTECTION.shieldHours - 1) * HOUR);
  assert.ok(m.until - m.stationedAt <= BLOCKADE.hours * HOUR);
});

test('el dueño puede romper el bloqueo con sus barcos', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  A.state.units.trirreme = 4;
  sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 4 });
  assert.ok(B.state.blockade);
  assert.equal(B.breakPort().ok, false); // sin barcos no hay nada que hacer
  B.state.units.dromon = 20;
  assert.equal(B.breakPort().ok, true);
  assert.equal(B.state.blockade, null);
  // La flota del bloqueo, hundida o de vuelta
  const left = A.state.missions.filter((x) => x.type === 'bloquear' && x.phase === 'estacionada');
  assert.equal(left.length, 0);
});

test('retirar el bloqueo devuelve la flota a casa', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  A.state.units.trirreme = 6;
  const m = sendAndArrive(env, A, 'bloquear', B.state.home, { trirreme: 6 });
  assert.equal(A.recall(m.id).ok, true);
  assert.equal(B.state.blockade, null);
  env.until(m.back);
  assert.equal(lastMission(A), undefined);
  assert.equal(A.state.units.trirreme, 6);
});
