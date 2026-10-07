# Imperium

Juego de estrategia y gestión de imperio en el navegador, al estilo de OGame o Ikariam, con un archipiélago en 3D hecho con [Three.js](https://threejs.org/).

## Arrancar

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Para probar más rápido: `http://localhost:5173/?speed=50` (multiplica la producción y acorta obras, investigaciones, reclutas y viajes).

## Cómo se juega

- Tu isla produce **madera, piedra, comida, hierro, cristal y oro** en tiempo real, también con la pestaña cerrada. Pasa el ratón por un recurso para ver de dónde sale.
- **12 edificios**: ayuntamiento, aserradero, cantera, granja, mina de cristal, fundición, mercado, almacén, academia, cuartel, puerto y muralla. Solo hay una obra a la vez; si la cancelas, recuperas los recursos.
- **Academia**: 13 investigaciones con niveles (producción, obras más rápidas, almacén, ataque, vida, navegación, cartografía…). Algunas desbloquean unidades.
- **Cuartel y puerto**: 5 tropas de tierra (lancero, arquero, espadachín, caballero, catapulta) y 4 barcos (bote explorador, mercante, trirreme, galeón). Las tropas comen: si te quedas sin comida hay hambruna y la producción cae a la mitad.
- **Mercado**: además de oro, cambia unos recursos por otros. El cambio mejora con su nivel y con Comercio.
- **Archipiélago** (botón 🗺️ o tecla `M`): 15 islas que hay que descubrir con botes exploradores.
  - Campamentos bárbaros y fortalezas piratas que puedes saquear. Se rearman con el tiempo.
  - Ruinas con un tesoro para el primero que llegue.
  - Islas deshabitadas que puedes **colonizar** (hace falta Cartografía y un mercante) para que produzcan para ti.
  - La Fosa del Kraken, el reto final.
- Las flotas tardan en ir y volver; se ven navegando por el mapa y se pueden retirar mientras van de ida. Los barcos mercantes cargan el botín.
- **Piratas**: desde el ayuntamiento nivel 3 tu isla sufre asaltos cada pocas horas. Se avistan con 20 minutos de antelación. Defienden las tropas que estén en casa y la muralla (más vida y torres que disparan). Si pierdes, se llevan parte de tus recursos.
- Los **informes** 📜 guardan cada combate, exploración y colonia.
- La partida se guarda sola en `localStorage`. Desde ⚙ se puede reiniciar.

## Estructura

```
src/
  config.js            velocidad del universo y clave de guardado
  game/data.js         recursos, edificios, unidades, investigaciones e islas
  game/rules.js        fórmulas: costes, tiempos, economía, capacidad, viajes
  game/combat.js       combate por asaltos
  game/Game.js         estado, bucle de sucesos, colas, flotas, piratas, guardado
  scene/World.js       escena 3D: tu isla, el archipiélago, flotas, cámara, selección
  scene/models.js      modelos low-poly de edificios, tropas y barcos
  scene/islands.js     islas del archipiélago según lo que sabes de ellas
  scene/util.js        utilidades de geometría y azar con semilla
  ui/Hud.js            barra de recursos, listas, actividad, avisos e informes
  ui/buildingPanel.js  panel de cada edificio (academia, cuartel, puerto, mercado…)
  ui/islandPanel.js    panel de una isla y formulario de flotas
  ui/reports.js        informes de combate
```

En la consola del navegador está disponible `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`, `setView`) para depurar.

## Próximos pasos posibles

- Servidor con cuentas y partida persistente (lo que hace que OGame sea multijugador).
- Gestionar las colonias como ciudades propias, con sus edificios.
- Rutas comerciales entre islas y diplomacia con otros imperios.
