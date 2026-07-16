import { NextResponse } from "next/server";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Todo API",
    description: "A comprehensive Todo application API with categories, tags, priorities, and advanced filtering.",
    version: "1.0.0",
  },
  servers: [
    { url: "http://localhost:3000", description: "Development server" },
  ],
  paths: {
    "/api/todos": {
      get: {
        summary: "List todos",
        description: "Retrieve a paginated list of todos with filtering, searching, and sorting.",
        tags: ["Todos"],
        parameters: [
          { name: "search", in: "query", schema: { type: "string" }, description: "Search in title and description (case-insensitive)" },
          { name: "completed", in: "query", schema: { type: "string", enum: ["true", "false"] }, description: "Filter by completion status" },
          { name: "priority", in: "query", schema: { type: "string" }, description: "Filter by priority (comma-separated: LOW,MEDIUM,HIGH,URGENT)" },
          { name: "categoryId", in: "query", schema: { type: "string" }, description: "Filter by category ID" },
          { name: "tagId", in: "query", schema: { type: "string" }, description: "Filter by tag ID" },
          { name: "dueBefore", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter todos due before this date" },
          { name: "dueAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter todos due after this date" },
          { name: "sortBy", in: "query", schema: { type: "string", enum: ["createdAt", "dueDate", "priority", "title"] }, description: "Sort field (default: createdAt)" },
          { name: "sortOrder", in: "query", schema: { type: "string", enum: ["asc", "desc"] }, description: "Sort order (default: desc)" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 }, description: "Page size (default: 20, max: 100)" },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0 }, description: "Pagination offset (default: 0)" },
        ],
        responses: {
          "200": {
            description: "List of todos",
            headers: { "X-Total-Count": { schema: { type: "integer" }, description: "Total number of matching todos" } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/TodoListResponse" } } },
          },
        },
      },
      post: {
        summary: "Create a todo",
        tags: ["Todos"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTodo" } } },
        },
        responses: {
          "201": { description: "Created todo", content: { "application/json": { schema: { $ref: "#/components/schemas/TodoResponse" } } } },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/api/todos/{id}": {
      get: {
        summary: "Get a todo by ID",
        tags: ["Todos"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Todo details", content: { "application/json": { schema: { $ref: "#/components/schemas/TodoResponse" } } } },
          "404": { description: "Todo not found" },
        },
      },
      patch: {
        summary: "Update a todo",
        tags: ["Todos"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTodo" } } },
        },
        responses: {
          "200": { description: "Updated todo", content: { "application/json": { schema: { $ref: "#/components/schemas/TodoResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo not found" },
        },
      },
      delete: {
        summary: "Delete a todo",
        tags: ["Todos"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Todo deleted" },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/todos/bulk": {
      post: {
        summary: "Bulk operations on todos",
        tags: ["Todos"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["operation", "ids"],
                properties: {
                  operation: { type: "string", enum: ["complete", "uncomplete", "delete"] },
                  ids: { type: "array", items: { type: "string" }, minItems: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Operation result" },
          "400": { description: "Validation error" },
        },
      },
    },
    "/api/todos/{id}/tags": {
      post: {
        summary: "Add tags to a todo",
        tags: ["Todos"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tagIds"],
                properties: { tagIds: { type: "array", items: { type: "string" } } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated todo with tags" },
          "404": { description: "Todo not found" },
        },
      },
      delete: {
        summary: "Remove a tag from a todo",
        tags: ["Todos"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tagId"],
                properties: { tagId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated todo without tag" },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/categories": {
      get: {
        summary: "List all categories",
        tags: ["Categories"],
        responses: {
          "200": { description: "List of categories with todo count", content: { "application/json": { schema: { $ref: "#/components/schemas/CategoryListResponse" } } } },
        },
      },
      post: {
        summary: "Create a category",
        tags: ["Categories"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateCategory" } } },
        },
        responses: {
          "201": { description: "Created category" },
          "400": { description: "Validation error" },
          "409": { description: "Category name already exists" },
        },
      },
    },
    "/api/categories/{id}": {
      get: {
        summary: "Get a category by ID",
        tags: ["Categories"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Category details with recent todos" },
          "404": { description: "Category not found" },
        },
      },
      patch: {
        summary: "Update a category",
        tags: ["Categories"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateCategory" } } },
        },
        responses: {
          "200": { description: "Updated category" },
          "404": { description: "Category not found" },
          "409": { description: "Category name already exists" },
        },
      },
      delete: {
        summary: "Delete a category",
        tags: ["Categories"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Category deleted" },
          "404": { description: "Category not found" },
          "409": { description: "Category has associated todos" },
        },
      },
    },
    "/api/tags": {
      get: {
        summary: "List all tags",
        tags: ["Tags"],
        responses: {
          "200": { description: "List of tags with usage count" },
        },
      },
      post: {
        summary: "Create a tag",
        tags: ["Tags"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateTag" } } },
        },
        responses: {
          "201": { description: "Created tag" },
          "400": { description: "Validation error" },
          "409": { description: "Tag name already exists" },
        },
      },
    },
    "/api/tags/{id}": {
      get: {
        summary: "Get a tag by ID",
        tags: ["Tags"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Tag details" },
          "404": { description: "Tag not found" },
        },
      },
      patch: {
        summary: "Update a tag",
        tags: ["Tags"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateTag" } } },
        },
        responses: {
          "200": { description: "Updated tag" },
          "404": { description: "Tag not found" },
          "409": { description: "Tag name already exists" },
        },
      },
      delete: {
        summary: "Delete a tag",
        tags: ["Tags"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Tag deleted" },
          "404": { description: "Tag not found" },
        },
      },
    },
  },
  components: {
    schemas: {
      Todo: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          completed: { type: "boolean" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          dueDate: { type: "string", format: "date-time", nullable: true },
          order: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          categoryId: { type: "string", nullable: true },
          category: { $ref: "#/components/schemas/Category" },
          tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
        },
      },
      CreateTodo: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 255 },
          description: { type: "string", maxLength: 1000 },
          completed: { type: "boolean" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          dueDate: { type: "string", format: "date-time" },
          categoryId: { type: "string" },
          order: { type: "integer" },
          tagIds: { type: "array", items: { type: "string" } },
        },
      },
      UpdateTodo: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 255 },
          description: { type: "string", maxLength: 1000, nullable: true },
          completed: { type: "boolean" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          dueDate: { type: "string", format: "date-time", nullable: true },
          categoryId: { type: "string", nullable: true },
          order: { type: "integer" },
          tagIds: { type: "array", items: { type: "string" } },
        },
      },
      Category: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          color: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreateCategory: {
        type: "object",
        required: ["name", "color"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          color: { type: "string", maxLength: 7 },
        },
      },
      UpdateCategory: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          color: { type: "string", maxLength: 7 },
        },
      },
      Tag: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          color: { type: "string" },
        },
      },
      CreateTag: {
        type: "object",
        required: ["name", "color"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          color: { type: "string", maxLength: 7 },
        },
      },
      UpdateTag: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          color: { type: "string", maxLength: 7 },
        },
      },
      TodoListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Todo" } },
        },
      },
      TodoResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/Todo" },
        },
      },
      CategoryListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: {
            type: "array",
            items: {
              allOf: [{ $ref: "#/components/schemas/Category" }, { type: "object", properties: { todoCount: { type: "integer" } } }],
            },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(openApiSpec);
}
