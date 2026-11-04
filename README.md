# Todo Backend API

A comprehensive Todo application API built with Next.js App Router, Prisma ORM, and PostgreSQL.

## Features

- Full CRUD operations for Todos, Categories, and Tags
- Advanced filtering, searching, and sorting
- Pagination with total count headers
- Bulk operations (complete, uncomplete, delete, reorder, priority, category, tags, and assignee)
- Priority levels (LOW, MEDIUM, HIGH, URGENT)
- Due date tracking
- Category and tag organization
- OpenAPI/Swagger documentation
- Zod input validation
- CORS support for frontend integration

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript (strict mode)
- **ORM**: Prisma
- **Database**: PostgreSQL 16
- **Validation**: Zod
- **API Docs**: OpenAPI 3.0 with Swagger UI

## Getting Started

### Prerequisites

- Node.js 18+
- Docker and Docker Compose (for PostgreSQL)

### Setup

1. Install dependencies:

```bash
npm install
```

2. Start the database:

```bash
docker compose up -d
```

3. Run migrations:

```bash
npm run db:migrate
```

4. Seed the database:

```bash
npm run db:seed
```

5. Start the development server:

```bash
npm run dev
```

The API will be available at http://localhost:3000.

## API Documentation

- **OpenAPI Spec (JSON)**: GET /api/doc
- **Swagger UI**: /api-doc

## API Endpoints

### Todos

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/todos | List todos (with search, filter, sort, pagination) |
| POST | /api/todos | Create a todo |
| GET | /api/todos/:id | Get a todo by ID |
| PATCH | /api/todos/:id | Update a todo |
| DELETE | /api/todos/:id | Delete a todo |
| POST | /api/todos/bulk | Bulk operations |
| POST | /api/todos/:id/tags | Add tags to a todo |
| DELETE | /api/todos/:id/tags | Remove a tag from a todo |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/categories | List all categories (with todo count) |
| POST | /api/categories | Create a category |
| GET | /api/categories/:id | Get a category by ID |
| PATCH | /api/categories/:id | Update a category |
| DELETE | /api/categories/:id | Delete a category |

### Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/tags | List all tags (with usage count) |
| POST | /api/tags | Create a tag |
| GET | /api/tags/:id | Get a tag by ID |
| PATCH | /api/tags/:id | Update a tag |
| DELETE | /api/tags/:id | Delete a tag |

## Query Parameters (GET /api/todos)

| Parameter | Type | Description |
|-----------|------|-------------|
| search | string | Case-insensitive search in title and description |
| completed | boolean | Filter by completion status |
| priority | string | Filter by priority (comma-separated: LOW,MEDIUM,HIGH,URGENT) |
| categoryId | string | Filter by category ID |
| tagId | string | Filter by tag ID |
| dueBefore | date | Filter todos due before this date |
| dueAfter | date | Filter todos due after this date |
| sortBy | string | Sort by: createdAt, dueDate, priority, title, order (default: createdAt) |
| sortOrder | string | Sort order: asc, desc (default: desc) |
| limit | number | Page size (default: 20, max: 100) |
| offset | number | Pagination offset (default: 0) |

## Response Format

All responses follow a consistent format:

```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "message": "Description of the error",
    "details": [...]
  }
}
```

## Scripts

| Command | Description |
|---------|-------------|
| npm run dev | Start development server |
| npm run build | Build for production |
| npm run start | Start production server |
| npm run lint | Run ESLint |
| npm run db:migrate | Run Prisma migrations |
| npm run db:seed | Seed the database |
| npm run db:reset | Reset the database |
| npm run db:studio | Open Prisma Studio |

`npm run db:seed` runs `prisma db seed`, which Prisma maps (via the `prisma`
key in `package.json`) to `npm run seed`: `ts-node --compiler-options
{"module":"CommonJS"} prisma/seed.ts`. `prisma/seed.ts` only runs its `main`
logic when executed as a script, guarded by `require.main === module`. That
guard is **CommonJS-only** — `require` and `module` do not exist when the file
is run under ESM (e.g. `tsx` or `node --loader` without the CommonJS compiler
override), so under ESM the guard's `typeof require !== "undefined"` check is
false and the seed silently does not run. Keep the `--compiler-options
{"module":"CommonJS"}` override on the `seed` script, or replace the guard with
an ESM-compatible entry-point check if the script is ever moved off `ts-node`
CommonJS mode.

## Environment Variables

Copy `.env.example` to `.env` and update as needed:

```
DATABASE_URL="postgresql://todouser:todopass@localhost:5432/tododb"
```

## Production deployment checklist

The following operational items are safe-by-default in dev/test but MUST be
addressed before a real production deploy:

- **Set `JWT_SECRET` to a strong, random value.** In production a missing
  `JWT_SECRET` now fails loudly (the app throws) instead of signing session
  tokens with the publicly-known dev default. Outside production the dev
  default is used so the build and test suite stay green without config.

- **Enable and back the rate limiter.** `RATE_LIMIT_ENABLED` defaults to
  `false`. The built-in limiter is an in-process fixed-window counter and is
  correct on a **single instance only**. On a multi-instance or serverless
  deployment, enabling it as-is yields an effective limit of
  `RATE_LIMIT_MAX × instances`. Before enabling it in such a deployment, wire a
  shared store (e.g. Redis/Upstash) implementing the `RateLimitStore` interface
  in `lib/rate-limit.ts`.

- **Back-fill `userId` when migrating a populated database.** Multi-tenancy
  (FEAT-002) adds a non-nullable `userId` to `Todo`, `Category`, and `Tag`. On
  a fresh database `prisma migrate dev` + seed just works. Against a database
  that already contains rows, adding the non-nullable column will fail unless
  the migration first adds the column as nullable, back-fills existing rows with
  a real owner's id, then sets `NOT NULL` and the foreign key (or the data is
  reset). Author an explicit back-fill migration for that path; do not run the
  generated migration unchanged against existing data.
