// Llamadas al servidor. La sesión es un token que se guarda en el navegador.

const TOKEN_KEY = 'imperium.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // sin almacenamiento: la sesión dura lo que la pestaña
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(method, path, body) {
  const token = getToken();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor.', 0);
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // respuesta vacía
  }
  if (!res.ok) throw new ApiError(data.error ?? `Error ${res.status}`, res.status);
  return data;
}
