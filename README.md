# Imperium

Juego de estrategia y gestión de imperio en el navegador, al estilo de OGame o Ikariam, con un archipiélago en 3D hecho con [Three.js](https://threejs.org/).

## Arrancar

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Para probar más rápido: `http://localhost:5173/?speed=50` (multiplica la producción y acorta obras, investigaciones, reclutas y viajes). Con `?save=prueba` se usa otra partida guardada, así puedes trastear sin tocar la tuya.

## Cómo se juega

- Tu isla produce **madera, piedra, comida, hierro, cristal y oro** en tiempo real, también con la pestaña cerrada. Pasa el ratón por un recurso para ver de dónde sale.
- **14 edificios**: ayuntamiento, aserradero, cantera, granja, mina de cristal, fundición, mercado, almacén, academia, templo, cuartel, puerto, muralla y el **Coloso**, una maravilla de 10 niveles que da +5 % de producción por nivel y es el gran objetivo final. Solo hay una obra a la vez; si la cancelas, recuperas los recursos.
- **Templo y poderes divinos** (como en Grepolis): el templo genera favor para invocar la Cosecha abundante, la Inspiración, el Viento favorable, la Égida o la Ira de los dioses contra los piratas.
- **Misiones** 📋: una cadena de objetivos con recompensa que guía la partida de principio a fin.
- **Clasificación** 🏆: un punto por cada 100 recursos invertidos, contra nueve imperios rivales que también crecen.
- **Visitantes**: de vez en cuando llegan mercaderes con buenos tratos, mercenarios, peregrinos o restos de un naufragio.
- **Academia**: 13 investigaciones con niveles (producción, obras más rápidas, almacén, ataque, vida, navegación, cartografía…). Algunas desbloquean unidades.
- **Cuartel y puerto**: 5 tropas de tierra (lancero, arquero, espadachín, caballero, catapulta) y 4 barcos (bote explorador, mercante, trirreme, galeón). Las tropas comen: si te quedas sin comida hay hambruna y la producción cae a la mitad.
- **Mercado**: además de oro, cambia unos recursos por otros. El cambio mejora con su nivel y con Comercio.
- **Archipiélago** (botón 🗺️ o tecla `M`): 15 islas que hay que descubrir con botes exploradores.
  - Campamentos bárbaros y fortalezas piratas que puedes saquear. Se rearman con el tiempo.
  - Ruinas con un tesoro para el primero que llegue.
  - Islas deshabitadas que puedes **colonizar** (hace falta Cartografía y un mercante) para que produzcan para ti.
  - La Fosa del Kraken, el reto final.
  - El Mar de las Brumas, adonde se mandan **expediciones** (como en OGame): pecios, barcos abandonados, tesoros, emboscadas piratas, serpientes marinas, cartas náuticas…
- Las flotas tardan en ir y volver; se ven navegando por el mapa y se pueden retirar mientras van de ida. Los barcos mercantes cargan el botín.
- **Piratas**: desde el ayuntamiento nivel 3 tu isla sufre asaltos cada pocas horas. Se avistan con 20 minutos de antelación. Defienden las tropas que estén en casa y la muralla (más vida y torres que disparan). Si pierdes, se llevan parte de tus recursos, salvo lo que el almacén esconde.
- Los **informes** 📜 guardan cada combate, exploración y colonia.
- Ambiente: mar con espuma en las orillas, ciclo de día y noche con ventanas que se encienden, aldeanos, gaviotas y sonido sintetizado (oleaje, gaviotas, efectos). Desde ⚙ se pueden quitar el sonido y el ciclo de día y noche, o reiniciar la partida.
- La partida se guarda sola en `localStorage`.

## Estructura

```
src/
  config.js            velocidad del universo y clave de guardado
  audio.js             sonido sintetizado con Web Audio
  game/data.js         recursos, edificios, unidades, investigaciones, islas, poderes, misiones y rivales
  game/rules.js        fórmulas: costes, tiempos, economía, capacidad, viajes
  game/combat.js       combate por asaltos
  game/Game.js         estado, bucle de sucesos, colas, flotas, piratas, guardado
  scene/World.js       escena 3D: tu isla, el archipiélago, flotas, cámara, selección
  scene/models.js      modelos low-poly de edificios, tropas y barcos
  scene/islands.js     islas del archipiélago según lo que sabes de ellas
  scene/water.js       mar con olas, aguas claras y espuma en las orillas (shader)
  scene/util.js        utilidades de geometría y azar con semilla
  ui/Hud.js            barra de recursos, listas, actividad, avisos e informes
  ui/buildingPanel.js  panel de cada edificio (academia, cuartel, puerto, mercado…)
  ui/islandPanel.js    panel de una isla y formulario de flotas
  ui/reports.js        informes de combate
  ui/modals.js         misiones y clasificación
```

En la consola del navegador está disponible `window.__IMPERIUM__` (`game`, `world`, `hud`, `select`, `setView`) para depurar.

## Próximos pasos posibles

- Servidor con cuentas y partida persistente (lo que hace que OGame sea multijugador).
- Gestionar las colonias como ciudades propias, con sus edificios.
- Rutas comerciales entre islas y diplomacia con otros imperios.
