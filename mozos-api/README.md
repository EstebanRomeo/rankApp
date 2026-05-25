# mozos-api

Backend para el sistema de valoración de mozos. Node.js + Express + SQLite.

## Estructura

```
mozos-api/
├── src/
│   ├── index.js                 ← servidor Express, punto de entrada
│   ├── db/
│   │   └── database.js          ← schema SQLite, se crea solo al arrancar
│   ├── middleware/
│   │   └── auth.js              ← authCliente / authAdmin / authOpcional
│   └── routes/
│       ├── auth.js              ← /api/auth/*
│       ├── bares.js             ← /api/bares/*
│       ├── mozos.js             ← /api/mozos/*
│       ├── resenas.js           ← /api/resenas/*
│       └── alertas.js           ← /api/alertas/*
├── data/                        ← se crea sola, acá vive mozos.db
├── .env.example
└── package.json
```

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de variables de entorno
cp .env.example .env

# 3. Editar .env y cambiar los secretos JWT (importante en producción)

# 4. Arrancar en modo desarrollo
npm run dev

# o en producción
npm start
```

El servidor corre en http://localhost:3001

## Endpoints

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/auth/register | Registro de cliente |
| POST | /api/auth/login | Login de cliente |
| POST | /api/auth/admin/login | Login de admin |
| GET | /api/auth/me | Usuario del token activo |

### Bares
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/bares/register | — | Registrar bar nuevo + admin |
| GET | /api/bares/:id | — | Info pública del bar |
| GET | /api/bares/slug/:slug | — | Buscar bar por slug |
| PUT | /api/bares/:id | admin | Editar datos del bar |

### Mozos
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | /api/mozos/:id | — | Perfil público del mozo |
| POST | /api/mozos | admin | Agregar mozo al bar |
| PUT | /api/mozos/:id | admin | Editar mozo |
| DELETE | /api/mozos/:id | admin | Desactivar mozo |

### Reseñas
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/resenas | cliente | Crear reseña (con anti-spam) |
| GET | /api/resenas/mozo/:id | — | Reseñas de un mozo |
| GET | /api/resenas/bar/:id | admin | Todas las reseñas del bar |

### Alertas
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | /api/alertas/:bar_id | admin | Alertas automáticas del bar |

## Ejemplo: registrar un bar

```bash
curl -X POST http://localhost:3001/api/bares/register \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Martín",
    "apellido": "López",
    "email": "martin@mibar.com",
    "password": "mibar1234",
    "bar_nombre": "Dos Banderas",
    "bar_descripcion": "Bar de barrio con onda",
    "bar_color": "#1a1a2e"
  }'
```

Respuesta:
```json
{
  "token": "eyJ...",
  "usuario": { "id": 1, "nombre": "Martín López", "rol": "admin" },
  "bar": {
    "id": 1,
    "nombre": "Dos Banderas",
    "slug": "Dos-Banderas",
    "url_publica": "mozos.app/bar-el-farol"
  }
}
```

## Ejemplo: login desde el frontend React

```js
const response = await fetch('http://localhost:3001/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
const { token, usuario } = await response.json();
localStorage.setItem('token', token);
```

## Variables de entorno (.env)

| Variable | Descripción | Default |
|----------|-------------|---------|
| PORT | Puerto del servidor | 3001 |
| JWT_SECRET | Secreto para tokens de clientes | — |
| JWT_EXPIRES_IN | Expiración token cliente | 7d |
| JWT_ADMIN_SECRET | Secreto para tokens de admin | — |
| JWT_ADMIN_EXPIRES_IN | Expiración token admin | 1d |
| DB_PATH | Ruta del archivo SQLite | ./data/mozos.db |
| RESENA_COOLDOWN_HORAS | Horas entre reseñas del mismo usuario al mismo mozo | 4 |
| FRONTEND_URL | Origen permitido por CORS | http://localhost:3000 |
