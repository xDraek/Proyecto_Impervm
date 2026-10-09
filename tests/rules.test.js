import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assault, battle, count } from '../src/game/combat.js';
import { OCCUPATION } from '../src/game/data.js';
import { newState } from '../src/game/Game.js';
import { economy, portClosed, protectedAmount, storageCapacity } from '../src/game/rules.js';

// Fórmulas puras de rules.js y combat.js.

const city = () => {
  const s = newState({ now: 0, home: 'isla', name: 'Prueba' });
  s.colonies = [{ id: 'c1', name: 'Colonia', specialty: 'cristal', yield: 100 }];
  return s;
};

test('una ciudad libre recibe lo de sus colonias y no paga tributo', () => {
  const s = city();
  const eco = economy(s, 0);
  assert.equal(portClosed(s), false);
  assert.ok(eco.colonies.cristal > 0);
  for (const n of Object.values(eco.tribute)) assert.equal(n, 0);
});

test('con el puerto bloqueado las colonias no mandan nada', () => {
  const s = city();
  s.blockade = { by: 2, name: 'Otro', mission: 1, since: 0, until: 1 };
  const eco = economy(s, 0);
  assert.equal(portClosed(s), true);
  assert.equal(eco.colonies.cristal, 0);
  for (const n of Object.values(eco.tribute)) assert.equal(n, 0);
});

test('una ciudad ocupada paga su parte de tributo de todo lo que produce', () => {
  const s = city();
  s.occupied = { by: 2, name: 'Otro', mission: 1, since: 0, until: 1, owed: {} };
  const eco = economy(s, 0);
  assert.equal(eco.colonies.cristal, 0);
  for (const res of ['madera', 'piedra', 'comida']) {
    assert.ok(Math.abs(eco.tribute[res] - eco.gross[res] * OCCUPATION.tribute) < 1e-9);
    assert.ok(eco.net[res] < eco.gross[res]);
  }
});

test('el almacén sube el máximo y esconde más cuanto más nivel tiene', () => {
  const at = (n) => ({ buildings: { almacen: n }, research: {} });
  assert.ok(storageCapacity(at(5)) > storageCapacity(at(1)));
  assert.equal(protectedAmount(at(0)), 100);
  assert.equal(protectedAmount(at(4)), 1100);
});

test('una batalla muy desigual la gana el más fuerte', () => {
  const r = battle({ units: { hoplita: 200 } }, { units: { lancero: 5 } });
  assert.equal(r.winner, 'att');
  assert.equal(count(r.def.left), 0);
});

test('si la flota defensora sigue a flote, no hay desembarco', () => {
  const r = assault({ units: { mercante: 2, lancero: 20 } }, { units: { dromon: 10, lancero: 1 } });
  assert.equal(r.seaWon, false);
  assert.equal(r.landed, false);
  assert.notEqual(r.winner, 'att');
});

test('sin tropas de tierra se gana el mar pero no la ciudad', () => {
  const r = assault({ units: { dromon: 10 } }, { units: { trirreme: 1, lancero: 10 } }, { needLanding: true });
  assert.equal(r.seaWon, true);
  assert.equal(r.landed, false);
  assert.equal(r.winner, 'draw');
});

test('con el mar libre, las tropas desembarcan y toman la ciudad', () => {
  const r = assault({ units: { dromon: 10, hoplita: 150 } }, { units: { lancero: 10 } }, { needLanding: true });
  assert.equal(r.landed, true);
  assert.equal(r.winner, 'att');
});
