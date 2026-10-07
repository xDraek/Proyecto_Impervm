# Imperium

Juego de navegador de gestión de imperio al estilo de OGame o Ikariam: una isla low-poly en 3D hecha con Three.js y Vite. Por ahora es para un jugador y no tiene servidor; la partida se guarda en `localStorage`.

- El usuario escribe en español. Responde, comenta el código y escribe los textos del juego en español.
- Estructura: las reglas puras van en `src/game/` (sin Three.js ni DOM, para poder llevarlas a un servidor más adelante), la escena 3D en `src/scene/` y la interfaz HTML en `src/ui/`.
- Todo el tiempo de juego se calcula con marcas de tiempo (`Game.#advance`), así que la producción y las obras avanzan aunque la pestaña esté cerrada. No metas lógica de juego que dependa de los fotogramas.
- Los modelos de los edificios son procedurales (`src/scene/models.js`) y cambian con el nivel.

## Probar

- Servidor de desarrollo: configuración `imperium` en `.claude/launch.json` (puerto 5173).
- `?speed=N` acelera la producción y las obras.
- En la consola tienes `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`). Los clics sintéticos sobre el canvas sí funcionan.
- Si cambias niveles a mano en `game.state` para probar algo, llama después a `game.reset()` para no dejar la partida trucada guardada.
