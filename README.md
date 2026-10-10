# Viewmaster API

**Backend for the Viewmaster equipment inventory & logistics app.**

Stock per location and event, a permanent movement history, borrowed and damaged item tracking, and role-based access — behind a small REST API.

> Mobile app → [Viewmaster-app](https://github.com/DrThanosNT/Viewmaster-app)

---

## Overview

The API owns every rule about stock. The app only sends intent ("move 4 of these from A to B"); the API checks there is enough stock, updates the counts and writes the log entry **in the same database transaction**, so a count can never change without a matching history entry.

Highlights:

- Stock tracked per **item × location × event**, in three pools: usable, damaged and borrowed
- Grouped (batch) movements: one request, many lines, one log entry
- Permanent history that survives deleting items, locations, events or members
- Borrowed stock with return dates
- Three roles, checked against the database on every request
- Deletes that refuse to run while stock is still attached

## Concepts

### Locations

`STORAGE`, `VEHICLE` or `OTHER` (venues, sites). Two special **system locations** are created automatically and can't be deleted:

| Name | Purpose |
|---|---|
| Κατανάλωση | Where consumed stock goes. Acts as a running total of what was used up |
| Επιστροφή Δανεικών | Where borrowed stock goes when it is returned |

### Events

A name, a time period and one or more existing **non-storage** locations. A location can belong to several events, and an event can have several locations. When stock is sent to a venue *for an event*, it is stored in a separate bucket, so an event only ever sees the gear sent for it, while the location itself shows everything physically there.

### Stock

One row per `(item, location, event)`; an event-free row covers ordinary stock. Each row holds:

| Field | Meaning |
|---|---|
| `quantity` | Usable units |
| `damagedQuantity` | Damaged units |
| `temporaryQuantity` | Borrowed units, with an optional `expectedReturnAt` (the soonest date wins) |
| `runningLow` | Manual "running low" flag, cleared when new stock is imported |

### Movements

| Endpoint | Does |
|---|---|
| `POST /movements/batch` | Move stock between locations — or import it when a line has no source. Import lines can be marked temporary (borrowed) with a return date |
| `POST /movements/export-batch` | Consume stock (from the usable or the damaged pool) |
| `POST /movements/return-batch` | Return borrowed stock |
| `POST /movements/damage-batch` | Usable → damaged |
| `POST /movements/repair-batch` | Damaged → usable |

Every line is its own transaction; every request shares a `batchId`, which is how the logs group a whole cart into one entry.

Each log entry stores a **copy of the names** (item, locations, event, member). History is read from those copies only, so nothing in the log changes when something is renamed or deleted later.

## API

All routes except `POST /auth/login` and `GET /health` need an `Authorization: Bearer <token>` header.
Errors are returned as `{ "error": "message" }` with an HTTP status code. Messages are in Greek.

### Auth — `/auth`

| Method | Route | Access | Description |
|---|---|---|---|
| POST | `/login` | public | `{ phone \| email, password }` → `{ token, user }` |
| GET | `/me` | any | Current name and role (the app polls this) |
| PATCH | `/me/photo` | any | Set or clear the profile photo |
| POST | `/register` | admin | Create a member |
| GET | `/users` | admin | List members |
| PATCH | `/users/:id/role` | admin | Change a role (not your own) |
| DELETE | `/users/:id` | admin | Delete a member (not yourself) |

### Locations — `/locations`

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/` | any | List with stock and events. `?type=`, `?includeSystem=` |
| GET | `/:id` | any | One location with stock and events |
| POST | `/` | admin | Create (names are unique, case-insensitive) |
| PATCH | `/:id` | admin | Edit |
| DELETE | `/:id` | admin | Delete — only when empty, never system locations |

### Items — `/items`

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/` | any | List with stock. `?search=`, `?category=`, `?kind=` |
| GET | `/:id` | any | One item with stock and its 25 latest movements |
| POST | `/` | any | Create (`DISCRETE` or `CONSUMABLE`) |
| PATCH | `/:id` | any | Edit |
| DELETE | `/:id` | admin | Delete — only when no stock is left anywhere |

### Events — `/events`

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/` | any | List, newest first |
| GET | `/:id` | any | One event with its locations |
| POST | `/` | admin | Create — needs a name, a valid period and at least one non-storage location |
| PATCH | `/:id` | admin | Edit name or period |
| DELETE | `/:id` | admin | Delete — only when nothing is left tagged to it |

### Movements — `/movements`

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/` | any | Raw movements. `?itemId=`, `?locationId=`, `?take=`, `?skip=` |
| GET | `/logs` | any | Grouped history for the app. `?take=` |
| POST | `/` | any | A single movement |
| POST | `/batch` | any | Transport / import (see above) |
| POST | `/export-batch` | any | Consume |
| POST | `/return-batch` | any | Return borrowed stock |
| POST | `/damage-batch` | any | Mark damaged |
| POST | `/repair-batch` | any | Mark repaired |

### Stock — `/stock`

| Method | Route | Access | Description |
|---|---|---|---|
| GET | `/damaged` | any | Every damaged row, with its latest damage/repair entries |
| GET | `/temporary` | any | Every borrowed row, with return dates and latest entries |
| PATCH | `/running-low` | any | `{ itemId, locationId, eventId, value }` |

### Health

`GET /health` → `{ "ok": true }`

## Roles

| Role | Can do |
|---|---|
| `WORKER` | Everything in the tables above marked *any* |
| `MANAGER` | Same as `WORKER` for now |
| `ADMIN` | Everything, including creating and deleting locations, events and members, changing roles and deleting items |

## Architecture

```mermaid
flowchart LR
    A["Request"] --> B["requireAuth<br/>verify token · re-check member"]
    B --> C["requireRole<br/>admin routes"]
    C --> D["Route handler<br/>validation"]
    D --> E[("PostgreSQL<br/>via Prisma transaction")]
```

### Data model

```mermaid
erDiagram
    USER |o--o{ MOVEMENT : "moved"
    ITEM ||--o{ STOCK : "counted in"
    LOCATION ||--o{ STOCK : "holds"
    EVENT |o--o{ STOCK : "tags"
    EVENT ||--o{ EVENT_LOCATION : "uses"
    LOCATION ||--o{ EVENT_LOCATION : "belongs to"
    ITEM |o--o{ MOVEMENT : "logged"
    LOCATION |o--o{ MOVEMENT : "from / to"
    EVENT |o--o{ MOVEMENT : "during"
```

## Setup

### Prerequisites

| Service | Required | Notes |
|---|---|---|
| Node.js 20+ | ✓ | |
| PostgreSQL | ✓ | Local or hosted |

### 1 — Clone

```bash
git clone https://github.com/DrThanosNT/Viewmaster-backend.git
cd Viewmaster-backend
npm install
```

### 2 — Environment Variables

Copy `.env.example` to `.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/viewmaster?schema=public"
JWT_SECRET="generate-a-long-random-string"
PORT=4000
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | Secret used to sign tokens. Use a long random string |
| `PORT` | | Defaults to `4000` |
| `NODE_ENV` | | Set to `production` to keep technical database details out of error responses |

`.env` is read from the folder you start the server in, so run the commands below from the project root.

### 3 — Database

Create the database, then run the migrations:

```bash
npm run prisma:migrate
```

### 4 — Seed (optional, development only)

```bash
npm run prisma:seed
```

> ⚠️ **The seed deletes all existing data first.** Never run it against a database you care about.

It creates demo members, locations, items, stock and history. Password for all accounts: `password123`

| Phone | Name | Role |
|---|---|---|
| `6900000000` | Θάνος | Admin |
| `6900000001` | Μαρία | Worker |
| `6900000002` | Κώστας | Worker |
| `6900000003` | Ελένη | Manager |

### 5 — Development

```bash
npm run dev
```

The API listens on `http://localhost:4000`. Check it with:

```bash
curl http://localhost:4000/health
```

To use it from a phone on the same network, point the app at your computer's LAN IP (see the app README).

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start with automatic restart (nodemon) |
| `npm start` | Start normally |
| `npm run prisma:migrate` | Create and apply migrations (development) |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:studio` | Open Prisma Studio to browse the data |
| `npm run prisma:seed` | Reset and fill with demo data |

## Project Structure

```
prisma/
├── schema.prisma
├── migrations/
└── seed.js
src/
├── server.js                # app setup and route mounting
├── loadEnv.js               # reads .env
├── prismaClient.js
├── middleware/
│   └── auth.js              # requireAuth, requireRole
├── routes/
│   ├── auth.js
│   ├── locations.js
│   ├── items.js
│   ├── events.js
│   ├── movements.js         # all stock rules live here
│   └── stock.js
└── utils/
    └── httpError.js         # error type and friendly error responses
```

## Authentication

- Phone (or email) + password; passwords are hashed with bcrypt.
- Login returns a signed token valid for 30 days.
- On **every** request the member is looked up again. A deleted member is locked out immediately, and a role change applies immediately — not when the token expires.
- Login attempts are rate limited: 5 failed attempts per 15 minutes for the same phone/email and address. The counter is kept in memory, so it resets when the server restarts.
- There is no public sign-up. Members are created by admins. The first admin comes from the seed script; on a production database, create the first admin directly in the database (for example with Prisma Studio, storing a bcrypt hash in `passwordHash`) instead of seeding.

## Deployment

Any host that runs Node.js and can reach a PostgreSQL database will do.

1. Create the database and set `DATABASE_URL`, `JWT_SECRET` and `NODE_ENV=production`.
2. Apply the migrations:
```bash
   npx prisma migrate deploy
```
3. Start the server:
```bash
   npm start
```
4. Serve the API over HTTPS and set the app's `BASE_URL` to the public address.

## Tech Stack

- Node.js
- Express 5
- Prisma ORM
- PostgreSQL
- JSON Web Tokens
- bcrypt (bcryptjs)

## License

This project is provided for educational and demonstration purposes.

It is not licensed for commercial use without explicit permission from the author.
