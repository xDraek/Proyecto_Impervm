import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Almacenamiento del mundo. Dos opciones con la misma interfaz:
// - PgStore: Postgres (en la nube). Se usa si existe DATABASE_URL.
// - FileStore: un archivo JSON local, para desarrollar sin instalar nada.
//
// El servidor lo carga todo en memoria al arrancar y guarda lo que cambia cada
// pocos segundos, así que las lecturas nunca esperan a la base de datos.

export async function openStore({ databaseUrl, file }) {
  if (databaseUrl) {
    const store = new PgStore(databaseUrl);
    await store.init();
    return store;
  }
  const store = new FileStore(file);
  await store.init();
  return store;
}

const emptyData = () => ({ meta: {}, users: [], players: {}, islands: [], islandStates: {}, chat: [] });

export class FileStore {
  constructor(file) {
    this.file = file;
    this.kind = 'archivo';
  }

  async init() {
    try {
      this.data = { ...emptyData(), ...JSON.parse(await readFile(this.file, 'utf8')) };
    } catch {
      this.data = emptyData();
    }
  }

  async load() {
    return structuredClone(this.data);
  }

  async createUser({ username, pass, created, email = null }) {
    const id = (this.data.meta.nextUserId ?? 1) + 0;
    this.data.meta.nextUserId = id + 1;
    this.data.users.push({ id, username, pass, created, email });
    await this.#write();
    return id;
  }

  async updateEmail(id, email) {
    const user = this.data.users.find((u) => u.id === id);
    if (user) user.email = email;
    await this.#write();
  }

  async updatePassword(id, pass) {
    const user = this.data.users.find((u) => u.id === id);
    if (user) user.pass = pass;
    await this.#write();
  }

  async save({ meta, players, islands, islandStates, chat }) {
    if (meta) Object.assign(this.data.meta, meta);
    for (const { userId, state } of players ?? []) this.data.players[userId] = state;
    for (const isl of islands ?? []) {
      const i = this.data.islands.findIndex((x) => x.id === isl.id);
      if (i >= 0) this.data.islands[i] = isl;
      else this.data.islands.push(isl);
    }
    for (const [id, st] of islandStates ?? []) this.data.islandStates[id] = st;
    for (const msg of chat ?? []) this.data.chat.push(msg);
    if (this.data.chat.length > 200) this.data.chat.splice(0, this.data.chat.length - 200);
    await this.#write();
  }

  async #write() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data));
    await rename(tmp, this.file);
  }
}

export class PgStore {
  constructor(url) {
    this.url = url;
    this.kind = 'postgres';
  }

  /** `pool` permite usar otro cliente compatible con pg (para pruebas). */
  async init(pool) {
    if (pool) this.pool = pool;
    else {
      const { default: pg } = await import('pg');
      // Los Postgres en la nube suelen pedir SSL; en local no
      const local = /localhost|127\.0\.0\.1/.test(this.url);
      this.pool = new pg.Pool({ connectionString: this.url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    }
    await this.pool.query(`
      create table if not exists users (
        id serial primary key,
        username text not null,
        username_lc text not null unique,
        pass text not null,
        created bigint not null
      );
      alter table users add column if not exists email text;
      create unique index if not exists users_email on users (email) where email is not null;
      create table if not exists players (user_id integer primary key, state jsonb not null, updated bigint not null);
      create table if not exists islands (id text primary key, data jsonb not null, state jsonb);
      create table if not exists meta (key text primary key, value jsonb not null);
      create table if not exists chat (id serial primary key, msg jsonb not null);
    `);
  }

  async load() {
    const q = (sql) => this.pool.query(sql).then((r) => r.rows);
    const [meta, users, players, islands, chat] = await Promise.all([
      q('select key, value from meta'),
      q('select id, username, pass, created, email from users order by id'),
      q('select user_id, state from players'),
      q('select id, data, state from islands'),
      q('select msg from chat order by id desc limit 200'),
    ]);
    const data = emptyData();
    for (const row of meta) data.meta[row.key] = row.value;
    data.users = users.map((u) => ({ ...u, created: Number(u.created) }));
    for (const row of players) data.players[row.user_id] = row.state;
    for (const row of islands) {
      data.islands.push(row.data);
      if (row.state) data.islandStates[row.id] = row.state;
    }
    data.chat = chat.map((r) => r.msg).reverse();
    return data;
  }

  async createUser({ username, pass, created, email = null }) {
    const { rows } = await this.pool.query('insert into users (username, username_lc, pass, created, email) values ($1, $2, $3, $4, $5) returning id', [
      username,
      username.toLowerCase(),
      pass,
      created,
      email,
    ]);
    return rows[0].id;
  }

  async updateEmail(id, email) {
    await this.pool.query('update users set email = $2 where id = $1', [id, email]);
  }

  async updatePassword(id, pass) {
    await this.pool.query('update users set pass = $2 where id = $1', [id, pass]);
  }

  async save({ meta, players, islands, islandStates, chat }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const [key, value] of Object.entries(meta ?? {})) {
        await client.query('insert into meta (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(value)]);
      }
      for (const { userId, state } of players ?? []) {
        await client.query(
          'insert into players (user_id, state, updated) values ($1, $2, $3) on conflict (user_id) do update set state = excluded.state, updated = excluded.updated',
          [userId, JSON.stringify(state), Date.now()],
        );
      }
      for (const isl of islands ?? []) {
        await client.query('insert into islands (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data', [isl.id, JSON.stringify(isl)]);
      }
      for (const [id, st] of islandStates ?? []) {
        await client.query('update islands set state = $2 where id = $1', [id, JSON.stringify(st)]);
      }
      for (const msg of chat ?? []) await client.query('insert into chat (msg) values ($1)', [JSON.stringify(msg)]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
