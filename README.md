# Todo Backend API

A comprehensive Todo application API built with Next.js App Router, Prisma ORM, and PostgreSQL.

## Features

- Full CRUD operations for Todos, Categories, and Tags
- Advanced filtering, searching, and sorting
- Pagination with total count headers
- Bulk operations (complete, uncomplete, delete)
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
| sortBy | string | Sort by: createdAt, dueDate, priority, title (default: createdAt) |
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

## Environment Variables

Copy `.env.example` to `.env` and update as needed:

```
DATABASE_URL="postgresql://todouser:todopass@localhost:5432/tododb"
```
