import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clock } from '../src/config.js';
import { OCCUPATION } from '../src/game/data.js';
import { alive, makeWorld, sendAndArrive } from './world.js';

// Invasiones: ocupación, tributo, saqueo, flotas que zarpan de la ciudad ocupada y liberación.

const HOUR = 3_600_000;
const ARMY = { dromon: 8, hoplita: 150, mercante: 4 };

/** Lucio invade la ciudad de Aníbal (que solo tiene unos lanceros). */
async function invaded() {
  const env = await makeWorld();
  const [A, B] = env.players;
  Object.assign(A.state.units, { dromon: 12, hoplita: 200, mercante: 8, trirreme: 10, bote: 2 });
  B.state.units.lancero = 10;
  const m = sendAndArrive(env, A, 'invadir', B.state.home, ARMY);
  return { env, A, B, C: env.players[2], m };
}

test('si vence a su ejército, la invasión se queda ocupando la ciudad', async () => {
  const { env, A, B, m } = await invaded();
  assert.equal(m.phase, 'estacionada');
  assert.equal(B.state.occupied?.by, A.userId);
  assert.equal(env.world.playerInfo(B.userId).port.kind, 'invadir');
  assert.ok(m.until - m.stationedAt <= OCCUPATION.hours * HOUR);
  // Puerto cerrado para el dueño
  B.state.units.bote = 1;
  assert.match(B.planMission('explorar', A.state.home, { bote: 1 }).reason, /ocupa tu ciudad/);
});

test('sin tropas de tierra que se queden no hay ocupación', async () => {
  const env = await makeWorld();
  const [A, B] = env.players;
  Object.assign(A.state.units, { dromon: 10 });
  // Una invasión exige tropas de tierra
  assert.match(A.planMission('invadir', B.state.home, { dromon: 10 }).reason, /tropas de tierra/);
});

test('nadie más puede atacar una ciudad ocupada, ni el propio invasor', async () => {
  const { A, B, C } = await invaded();
  Object.assign(C.state.units, { dromon: 5, hoplita: 50 });
  assert.match(C.planMission('atacar', B.state.home, { dromon: 5, hoplita: 50 }).reason, /ocupa esta ciudad/);
  assert.match(A.planMission('atacar', B.state.home, { dromon: 1, hoplita: 1 }).reason, /Ya ocupas/);
});

test('el tributo se aparta y el saqueo lo manda a casa', async () => {
  const { env, A, B, m } = await invaded();
  env.advance(2 * HOUR);
  const owed = env.world.snapshot(A.userId).owed[m.id];
  assert.ok(owed.madera > 0, 'se aparta tributo de madera');
  // El primer saqueo ha sido el del asalto: hay que esperar
  assert.equal(A.plunder(m.id).ok, false);
  env.until(m.plunderAt);
  const before = { ...B.state.resources };
  const res = A.plunder(m.id);
  assert.equal(res.ok, true);
  assert.ok(B.state.resources.oro < before.oro, 'se llevan parte de su almacén');
  const convoy = A.state.missions.find((x) => x.type === 'tributo');
  assert.ok(convoy, 'sale un convoy hacia la capital');
  assert.equal(A.fleetsAtSea(), A.state.missions.length - 1, 'el convoy no ocupa hueco de flota');
  const oro = A.state.resources.oro;
  const sent = convoy.cargo.oro;
  assert.ok(sent > 0, 'el convoy lleva oro');
  env.until(convoy.back);
  assert.ok(A.state.resources.oro >= oro + sent, 'el botín llega a casa');
});

test('desde la ciudad ocupada se lanzan ataques que vuelven a ella', async () => {
  const { env, A, C, m } = await invaded();
  C.state.units.lancero = 3;
  const opts = { from: m.id };
  // Siempre se queda alguien de tierra guardando la ciudad
  assert.match(A.planMission('atacar', C.state.home, { hoplita: m.units.hoplita }, null, opts).reason, /Deja al menos una unidad de tierra/);
  const before = m.units.hoplita;
  const attack = sendAndArrive(env, A, 'atacar', C.state.home, { hoplita: 40, dromon: 3 }, opts);
  assert.equal(attack.from, m.target);
  assert.equal(m.units.hoplita, before - 40);
  env.until(attack.back);
  assert.ok(!A.state.missions.includes(attack), 'la flota ha vuelto');
  assert.ok(m.units.hoplita > before - 40, 'las tropas han vuelto a la ciudad ocupada');
  assert.equal(A.state.units.hoplita, 50, 'no han ido a la capital');
});

test('si se pierde la ciudad ocupada, la flota sigue hasta casa', async () => {
  const { env, A, B, C, m } = await invaded();
  C.state.units.lancero = 2;
  const attack = sendAndArrive(env, A, 'atacar', C.state.home, { hoplita: 30, dromon: 2 }, { from: m.id });
  A.recall(m.id); // se retira la ocupación mientras tanto
  assert.equal(B.state.occupied, null);
  env.until(attack.back);
  const home = A.state.missions.find((x) => x === attack);
  assert.ok(home && home.phase === 'vuelta' && home.base == null, 'sigue el viaje hasta la capital');
  env.until(home.back);
  assert.ok(!A.state.missions.includes(attack));
});

test('retirar la ocupación se lleva el tributo pendiente', async () => {
  const { env, A, B, m } = await invaded();
  env.advance(3 * HOUR);
  // Ya llevaban el botín del asalto: el tributo apartado se suma a eso
  const carried = m.cargo.madera ?? 0;
  const owed = Math.floor(B.state.occupied.owed.madera);
  assert.ok(owed > 0, 'hay tributo apartado');
  assert.equal(A.recall(m.id).ok, true);
  assert.equal(B.state.occupied, null);
  assert.ok(m.cargo.madera >= carried + owed, 'el tributo apartado se suma a la carga');
});

test('el dueño puede echar a los invasores y recupera el tributo', async () => {
  const { env, A, B, m } = await invaded();
  env.advance(3 * HOUR);
  const owed = B.state.occupied.owed.madera;
  B.state.units.espartano = 300;
  const madera = B.state.resources.madera;
  assert.equal(B.breakPort().ok, true);
  assert.equal(B.state.occupied, null);
  assert.ok(B.state.resources.madera >= madera + Math.floor(owed) - 1, 'el tributo apartado vuelve a su almacén');
  assert.ok(!A.state.missions.some((x) => x.id === m.id && x.phase === 'estacionada'));
});

test('las tropas de apoyo de su alianza liberan la ciudad al llegar', async () => {
  const { env, A, B, C, m } = await invaded();
  env.world.createAlliance(B.userId, 'Liga Púnica', 'LIP');
  env.world.joinAlliance(C.userId, env.world.allianceOf(B.userId).id);
  Object.assign(C.state.units, { dromon: 20, espartano: 200 });
  const sup = sendAndArrive(env, C, 'apoyo', B.state.home, { dromon: 20, espartano: 200 });
  assert.equal(B.state.occupied, null);
  assert.equal(sup.phase, 'estacionada', 'se quedan defendiendo');
  assert.ok(!A.state.missions.some((x) => x.id === m.id && x.phase === 'estacionada'));
});

test('si pasan a ser aliados, la ocupación termina sola', async () => {
  const { env, A, B, m } = await invaded();
  env.world.createAlliance(B.userId, 'Liga Púnica', 'LIP');
  env.world.joinAlliance(A.userId, env.world.allianceOf(B.userId).id);
  env.advance(20_000);
  assert.equal(B.state.occupied, null);
  assert.equal(m.phase, 'vuelta');
});

test('la ocupación termina sola al acabar su tiempo', async () => {
  const { env, B, m } = await invaded();
  env.until(m.until);
  assert.equal(B.state.occupied, null);
  assert.ok(B.shield() > clock.now());
  assert.ok(Object.keys(alive(m.units)).length > 0);
});
