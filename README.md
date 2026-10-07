# Imperium

Juego de estrategia y gestión de imperio en el navegador, al estilo de OGame o Ikariam, con una isla en 3D hecha con [Three.js](https://threejs.org/).

## Arrancar

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Para probar más rápido: `http://localhost:5173/?speed=50` (multiplica la producción y acorta las obras).

## Cómo se juega

- La isla produce **madera, piedra, cristal y oro** en tiempo real, también con la pestaña cerrada.
- Haz clic en un edificio (en la isla o en la lista) para ver su producción y el coste de la siguiente mejora.
- Solo hay **una obra a la vez**. Si cancelas una obra, se te devuelven los recursos.
- El **Almacén** limita cuántos recursos puedes acumular. El **Ayuntamiento** acelera las obras y desbloquea la mina y el mercado.
- La partida se guarda sola en `localStorage`. Desde ⚙ se puede reiniciar.

## Estructura

```
src/
  config.js        velocidad del universo y clave de guardado
  game/data.js     recursos y edificios (costes, producción, requisitos)
  game/rules.js    fórmulas: coste, tiempo, producción, capacidad
  game/Game.js     estado, avance del tiempo, cola de obras, guardado
  scene/World.js   escena 3D: isla, mar, nubes, cámara, selección
  scene/models.js  modelos low-poly procedurales de cada edificio
  ui/Hud.js        interfaz HTML: recursos, lista, panel, cola, avisos
```

En la consola del navegador está disponible `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`) para depurar.

## Próximos pasos posibles

- Servidor con cuentas y partida persistente (lo que hace que OGame sea multijugador).
- Investigación (árbol tecnológico), tropas y barcos.
- Mapa del mundo con otras islas, comercio y ataques.
