const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/mozos.db';

// Asegurar que existe el directorio
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Crear cliente local (archivo SQLite, sin servidor)
const client = createClient({
  url: `file:${path.resolve(DB_PATH)}`,
});

// ─── Wrapper sincrónico para mantener la misma API en las rutas ───────────────
// @libsql/client es async, pero usamos una clase wrapper para que
// las rutas no tengan que cambiar nada.
class DB {
  constructor(client) {
    this.client = client;
    this._init();
  }

  // Inicializar schema y pragmas
  async _init() {
    await this.client.execute('PRAGMA journal_mode = WAL');
    await this.client.execute('PRAGMA foreign_keys = ON');
    await this._createSchema();
    await this._insertBadges();
  }

  async _createSchema() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS usuarios (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre        TEXT    NOT NULL,
        email         TEXT    NOT NULL UNIQUE,
        password_hash TEXT,
        foto          TEXT,
        rol           TEXT    NOT NULL DEFAULT 'cliente' CHECK(rol IN ('cliente','admin')),
        activo        INTEGER NOT NULL DEFAULT 1,
        email_verificado INTEGER NOT NULL DEFAULT 0,
        oauth_provider TEXT,
        oauth_id       TEXT,
        fecha_registro TEXT NOT NULL DEFAULT (datetime('now')),
        ultimo_login   TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS bares (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre      TEXT NOT NULL,
        descripcion TEXT,
        logo        TEXT,
        color       TEXT NOT NULL DEFAULT '#1a1a2e',
        slug        TEXT UNIQUE,
        admin_id    INTEGER NOT NULL REFERENCES usuarios(id),
        activo      INTEGER NOT NULL DEFAULT 1,
        fecha_alta  TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS mozos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        bar_id      INTEGER NOT NULL REFERENCES bares(id),
        nombre      TEXT    NOT NULL,
        foto        TEXT,
        descripcion TEXT,
        turno       TEXT,
        activo      INTEGER NOT NULL DEFAULT 1,
        fecha_alta  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS resenas (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
        mozo_id      INTEGER NOT NULL REFERENCES mozos(id),
        atencion     INTEGER NOT NULL CHECK(atencion BETWEEN 1 AND 5),
        amabilidad   INTEGER NOT NULL CHECK(amabilidad BETWEEN 1 AND 5),
        rapidez      INTEGER NOT NULL CHECK(rapidez BETWEEN 1 AND 5),
        actitud      INTEGER NOT NULL CHECK(actitud BETWEEN 1 AND 5),
        comentario   TEXT,
        volveria     INTEGER DEFAULT 0,
        recomendaria INTEGER DEFAULT 0,
        ip_address   TEXT,
        fecha        TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        icono TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS mozo_badges (
        mozo_id  INTEGER NOT NULL REFERENCES mozos(id),
        badge_id INTEGER NOT NULL REFERENCES badges(id),
        mes      TEXT NOT NULL,
        PRIMARY KEY (mozo_id, badge_id, mes)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_resenas_mozo    ON resenas(mozo_id)`,
      `CREATE INDEX IF NOT EXISTS idx_resenas_usuario ON resenas(usuario_id)`,
      `CREATE INDEX IF NOT EXISTS idx_resenas_fecha   ON resenas(fecha)`,
      `CREATE INDEX IF NOT EXISTS idx_mozos_bar       ON mozos(bar_id)`,
    ];

    for (const sql of statements) {
      await this.client.execute(sql);
    }
  }

  async _insertBadges() {
    const badges = [
      [1, 'Más amable',     'Mayor puntaje en amabilidad del mes', '😊'],
      [2, 'Más rápido',     'Mayor puntaje en rapidez del mes',    '⚡'],
      [3, 'Favorito',       'Más recomendado del mes',             '⭐'],
      [4, 'Mejor atención', 'Mayor puntaje en atención del mes',   '🏆'],
      [5, 'Más consistente','Menor varianza en puntajes del mes',  '🎯'],
    ];
    for (const [id, nombre, descripcion, icono] of badges) {
      await this.client.execute({
        sql: `INSERT OR IGNORE INTO badges (id, nombre, descripcion, icono) VALUES (?,?,?,?)`,
        args: [id, nombre, descripcion, icono],
      });
    }
  }

  // ── API compatible con better-sqlite3 ──────────────────────────────────────

  // Devuelve un objeto con método .get(), .all(), .run()
  prepare(sql) {
    const clientRef = this.client;
    return {
      // Un solo resultado
      get: async (...args) => {
        const res = await clientRef.execute({ sql, args });
        return res.rows[0] ?? null;
      },
      // Múltiples resultados
      all: async (...args) => {
        const res = await clientRef.execute({ sql, args });
        return res.rows;
      },
      // INSERT / UPDATE / DELETE
      run: async (...args) => {
        const res = await clientRef.execute({ sql, args });
        return {
          lastInsertRowid: Number(res.lastInsertRowid),
          changes: res.rowsAffected,
        };
      },
    };
  }

  // Ejecutar SQL directo
  async exec(sql) {
    await this.client.execute(sql);
  }

  // Transacción: recibe una función async y la ejecuta en una tx
  transaction(fn) {
    const clientRef = this.client;
    return async (...args) => {
      await clientRef.execute('BEGIN');
      try {
        const result = await fn(...args);
        await clientRef.execute('COMMIT');
        return result;
      } catch (err) {
        await clientRef.execute('ROLLBACK');
        throw err;
      }
    };
  }
}

const db = new DB(client);

module.exports = db;
