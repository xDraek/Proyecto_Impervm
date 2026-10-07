const params = new URLSearchParams(location.search);

// Multiplicador de velocidad del universo (producción y tiempos de obra).
// Útil para probar: http://localhost:5173/?speed=50
export const GAME_SPEED = Math.max(1, Number(params.get('speed')) || 1);

// ?save=prueba usa otra partida guardada, para probar sin tocar la de verdad
const slot = params.get('save');
export const SAVE_KEY = slot ? `imperium.save.${slot}` : 'imperium.save.v1';
