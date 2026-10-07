# Imperium

Juego de navegador de gestión de imperio al estilo de OGame o Ikariam: un archipiélago low-poly en 3D hecho con Three.js y Vite. Por ahora es para un jugador y no tiene servidor; la partida se guarda en `localStorage`.

- El usuario escribe en español. Responde, comenta el código y escribe los textos del juego en español.
- Estructura: las reglas puras van en `src/game/` (sin Three.js ni DOM, para poder llevarlas a un servidor más adelante), la escena 3D en `src/scene/` y la interfaz HTML en `src/ui/`.
- Todo el tiempo de juego se calcula con marcas de tiempo. `Game.#advance` procesa en orden cronológico los sucesos (obras, investigaciones, reclutas, flotas, piratas) y acumula la producción entre uno y otro, así que todo avanza aunque la pestaña esté cerrada. No metas lógica de juego que dependa de los fotogramas: si añades algo con fecha, dale su suceso en `#nextEvent`.
- Los datos (edificios, unidades, investigaciones, islas) viven en `src/game/data.js`. Los requisitos (`requires`) mezclan edificios e investigaciones, así que sus ids no se pueden repetir.
- La interfaz solo regenera el HTML de un panel cuando cambia (evento `change` de la partida); lo que corre con el reloj se refresca en el sitio con atributos `data-until`, `data-bar`, `data-cost`, `data-need` y `data-wait` (ver `Hud#refreshLive`).
- Los modelos de los edificios son procedurales (`src/scene/models.js`) y cambian con el nivel. Las islas del mapa están en `src/scene/islands.js`.
- La partida guardada lleva versión (`SAVE_VERSION` en `Game.js`); `loadState` amplía las partidas antiguas con los campos nuevos.

## Probar

- Servidor de desarrollo: configuración `imperium` en `.claude/launch.json` (puerto 5173).
- `?speed=N` acelera la producción, las obras, las investigaciones, los reclutas y los viajes.
- En la consola tienes `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`, `setView`). Los clics sintéticos sobre el canvas y en los botones sí funcionan.
- Si cambias niveles a mano en `game.state` para probar algo, llama después a `game.reset()` para no dejar la partida trucada guardada.
