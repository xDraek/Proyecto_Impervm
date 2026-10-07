// Ajustes compartidos por el navegador y el servidor.

/**
 * Velocidad del universo (producción, obras, viajes…). La decide el servidor
 * (variable GAME_SPEED) y el navegador la recibe al conectarse.
 */
export const universe = { speed: 1 };

/** Reloj del juego. En el navegador se corrige con la hora del servidor. */
export const clock = {
  offset: 0,
  now: () => Date.now() + clock.offset,
};
