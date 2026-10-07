import { getToken } from './api.js';

// Conexión en vivo con el servidor: le llegan los estados nuevos (un ataque,
// una flota que vuelve…) y los mensajes del chat al momento. Si se corta,
// reintenta con esperas cada vez más largas; mientras tanto el juego sigue
// preguntando al servidor de vez en cuando.

export function connectLive(game, { onChat, onChatDelete, onBanned }) {
  let retry = 1000;
  let ws = null;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken() ?? '')}`);
    ws.onopen = () => {
      retry = 1000;
      game.live = true;
      game.sync();
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'snapshot') game.applySnapshot(msg.data);
      else if (msg.type === 'chat') onChat(msg.message);
      else if (msg.type === 'chat-delete') onChatDelete(msg.id);
    };
    ws.onclose = (e) => {
      game.live = false;
      if (e.code === 4003) return onBanned();
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 30_000);
    };
  };
  open();
  return () => ws?.close();
}
