import { NextResponse } from "next/server";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Todo API",
    description: "A comprehensive Todo application API with categories, tags, priorities, and advanced filtering. All endpoints except /api/auth/* and /api/doc require authentication; sign up or log in to obtain a session (httpOnly cookie) and all data is scoped to the authenticated user.",
    version: "1.0.0",
  },
  servers: [
    { url: "http://localhost:3000", description: "Development server" },
  ],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    "/api/auth/signup": {
      post: {
        summary: "Register a new user",
        description: "Create a new user account and start a session (sets an httpOnly session cookie).",
        tags: ["Auth"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SignupInput" } } },
        },
        responses: {
          "201": { description: "Created user", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "409": { description: "Email already registered", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Log in",
        description: "Authenticate with email and password and start a session (sets an httpOnly session cookie).",
        tags: ["Auth"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } },
        },
        responses: {
          "200": { description: "Authenticated user", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        summary: "Log out",
        description: "Clear the session cookie.",
        tags: ["Auth"],
        security: [],
        responses: {
          "200": { description: "Logged out" },
        },
      },
    },
    "/api/auth/me": {
      get: {
        summary: "Get the current user",
        description: "Return the authenticated user's profile. Requires authentication.",
        tags: ["Auth"],
        responses: {
          "200": { description: "Current user", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "401": { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
        },
      },
    },
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
          { name: "parentId", in: "query", schema: { type: "string" }, description: "List the subtasks (children) of this todo ID" },
          { name: "includeSubtasks", in: "query", schema: { type: "string", enum: ["true", "false"] }, description: "When true, return a flat list including subtasks. By default only top-level todos are returned." },
          { name: "dueBefore", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter todos due before this date" },
          { name: "dueAfter", in: "query", schema: { type: "string", format: "date-time" }, description: "Filter todos due after this date" },
          { name: "dueFilter", in: "query", schema: { type: "string", enum: ["today", "upcoming", "overdue"] }, description: "Smart due-date list: today (due today), upcoming (due tomorrow onward), or overdue (due before today)" },
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
    "/api/todos/{id}/comments": {
      get: {
        summary: "List a todo's comment thread",
        description: "Return the comments on a todo, oldest first. Owner-scoped.",
        tags: ["Comments"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "List of comments", content: { "application/json": { schema: { $ref: "#/components/schemas/CommentListResponse" } } } },
          "404": { description: "Todo not found" },
        },
      },
      post: {
        summary: "Add a comment to a todo",
        tags: ["Comments"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateComment" } } },
        },
        responses: {
          "201": { description: "Created comment", content: { "application/json": { schema: { $ref: "#/components/schemas/CommentResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/todos/{id}/comments/{commentId}": {
      patch: {
        summary: "Edit a comment",
        tags: ["Comments"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "commentId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateComment" } } },
        },
        responses: {
          "200": { description: "Updated comment", content: { "application/json": { schema: { $ref: "#/components/schemas/CommentResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo or comment not found" },
        },
      },
      delete: {
        summary: "Delete a comment",
        tags: ["Comments"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "commentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Comment deleted" },
          "404": { description: "Todo or comment not found" },
        },
      },
    },
    "/api/todos/{id}/attachments": {
      get: {
        summary: "List a todo's attachment references",
        description: "Return the attachment metadata references on a todo. Attachments store a URL/filename reference only; binary upload to an object store is deferred and config-gated.",
        tags: ["Attachments"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "List of attachments", content: { "application/json": { schema: { $ref: "#/components/schemas/AttachmentListResponse" } } } },
          "404": { description: "Todo not found" },
        },
      },
      post: {
        summary: "Add an attachment reference to a todo",
        description: "Store a URL/filename reference as attachment metadata (no binary upload).",
        tags: ["Attachments"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateAttachment" } } },
        },
        responses: {
          "201": { description: "Created attachment", content: { "application/json": { schema: { $ref: "#/components/schemas/AttachmentResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/todos/{id}/attachments/{attachmentId}": {
      delete: {
        summary: "Remove an attachment reference",
        tags: ["Attachments"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "attachmentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Attachment deleted" },
          "404": { description: "Todo or attachment not found" },
        },
      },
    },
    "/api/todos/{id}/activity": {
      get: {
        summary: "Read a todo's activity log",
        description: "Return the append-only activity log for a todo (newest first). Entries are written on todo create/update/complete/delete and on comment/attachment changes.",
        tags: ["Activity"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "List of activity entries", content: { "application/json": { schema: { $ref: "#/components/schemas/ActivityListResponse" } } } },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/todos/{id}/reminders": {
      get: {
        summary: "List a todo's reminders",
        description: "Return the reminders scheduled on a todo, soonest first. Owner-scoped.",
        tags: ["Reminders"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "List of reminders", content: { "application/json": { schema: { $ref: "#/components/schemas/ReminderListResponse" } } } },
          "404": { description: "Todo not found" },
        },
      },
      post: {
        summary: "Schedule a reminder on a todo",
        tags: ["Reminders"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateReminder" } } },
        },
        responses: {
          "201": { description: "Created reminder", content: { "application/json": { schema: { $ref: "#/components/schemas/ReminderResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo not found" },
        },
      },
    },
    "/api/todos/{id}/reminders/{reminderId}": {
      patch: {
        summary: "Update a reminder",
        tags: ["Reminders"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "reminderId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateReminder" } } },
        },
        responses: {
          "200": { description: "Updated reminder", content: { "application/json": { schema: { $ref: "#/components/schemas/ReminderResponse" } } } },
          "400": { description: "Validation error" },
          "404": { description: "Todo or reminder not found" },
        },
      },
      delete: {
        summary: "Delete a reminder",
        tags: ["Reminders"],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "reminderId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Reminder deleted" },
          "404": { description: "Todo or reminder not found" },
        },
      },
    },
    "/api/reminders/dispatch": {
      post: {
        summary: "Dispatch due reminders",
        description:
          "Find reminders whose remindAt has passed and that are not yet sent, deliver each over its channel transport (in-app writes a Notification; email/push are config-gated and no-op when unconfigured), then stamp sentAt. Intended to be called on an interval by an external scheduler/cron in production (there is no in-process scheduler). Protected by the normal user auth guard, or by the REMINDER_DISPATCH_SECRET shared secret sent in the X-Dispatch-Secret header for unattended schedulers.",
        tags: ["Reminders"],
        responses: {
          "200": { description: "Dispatch result", content: { "application/json": { schema: { $ref: "#/components/schemas/DispatchResponse" } } } },
          "401": { description: "Authentication (or a valid dispatch secret) required" },
        },
      },
    },
    "/api/notifications": {
      get: {
        summary: "List the current user's notifications",
        description: "Return the authenticated user's notifications, newest first. Pass read=false to return only unread ones. Exposes an X-Total-Count header.",
        tags: ["Notifications"],
        parameters: [
          { name: "read", in: "query", required: false, schema: { type: "string", enum: ["true", "false"] } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": { description: "List of notifications", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationListResponse" } } } },
        },
      },
    },
    "/api/notifications/{id}": {
      patch: {
        summary: "Mark a notification read or unread",
        description: "Mark the notification read (default) or unread via body { read }. Owner-scoped.",
        tags: ["Notifications"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: false,
          content: { "application/json": { schema: { $ref: "#/components/schemas/MarkNotification" } } },
        },
        responses: {
          "200": { description: "Updated notification", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationResponse" } } } },
          "404": { description: "Notification not found" },
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
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "token",
        description: "Session JWT stored in an httpOnly cookie, set by signup/login.",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Session JWT passed as 'Authorization: Bearer <token>'.",
      },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      SignupInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", maxLength: 255 },
          password: { type: "string", minLength: 8, maxLength: 128 },
          name: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      AuthResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/User" },
        },
      },
      Todo: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string", nullable: true, description: "Freeform notes. Treated as GitHub-flavoured markdown; clients render it sanitized." },
          completed: { type: "boolean" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          startDate: { type: "string", format: "date-time", nullable: true },
          dueDate: { type: "string", format: "date-time", nullable: true },
          recurrenceRule: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"], nullable: true, description: "Recurrence frequency; when set, completing the todo spawns the next occurrence" },
          recurrenceInterval: { type: "integer", minimum: 1, description: "Number of frequency units between occurrences (e.g. every 2 weeks)" },
          recurrenceGeneratedId: { type: "string", nullable: true, description: "ID of the next occurrence spawned when this recurring todo was completed" },
          order: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          categoryId: { type: "string", nullable: true },
          category: { $ref: "#/components/schemas/Category" },
          tags: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
          parentId: { type: "string", nullable: true, description: "ID of the parent todo when this todo is a subtask" },
          children: { type: "array", items: { $ref: "#/components/schemas/Todo" }, description: "Direct subtasks of this todo" },
          progress: {
            type: "object",
            description: "Subtask completion summary for this todo",
            properties: {
              total: { type: "integer", description: "Number of direct subtasks" },
              completed: { type: "integer", description: "Number of completed direct subtasks" },
            },
          },
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
          startDate: { type: "string", format: "date-time" },
          dueDate: { type: "string", format: "date-time" },
          recurrenceRule: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"] },
          recurrenceInterval: { type: "integer", minimum: 1, maximum: 365 },
          categoryId: { type: "string" },
          parentId: { type: "string", description: "Create this todo as a subtask of the given parent todo" },
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
          startDate: { type: "string", format: "date-time", nullable: true },
          dueDate: { type: "string", format: "date-time", nullable: true },
          recurrenceRule: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY"], nullable: true },
          recurrenceInterval: { type: "integer", minimum: 1, maximum: 365 },
          categoryId: { type: "string", nullable: true },
          parentId: { type: "string", nullable: true, description: "Reparent this todo under the given parent, or null to make it top-level" },
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
      Comment: {
        type: "object",
        properties: {
          id: { type: "string" },
          body: { type: "string" },
          todoId: { type: "string" },
          userId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CreateComment: {
        type: "object",
        required: ["body"],
        properties: {
          body: { type: "string", minLength: 1, maxLength: 2000 },
        },
      },
      Attachment: {
        type: "object",
        properties: {
          id: { type: "string" },
          filename: { type: "string" },
          url: { type: "string", description: "A reference URL (http/https). No binary is stored server-side." },
          mimeType: { type: "string", nullable: true },
          size: { type: "integer", nullable: true, description: "Size in bytes, if known" },
          todoId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreateAttachment: {
        type: "object",
        required: ["filename", "url"],
        properties: {
          filename: { type: "string", minLength: 1, maxLength: 255 },
          url: { type: "string", maxLength: 2048, description: "An http(s) URL referencing the file" },
          mimeType: { type: "string", maxLength: 255 },
          size: { type: "integer", minimum: 0 },
        },
      },
      ActivityLogEntry: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", description: "e.g. todo.created, todo.completed, comment.created, attachment.added" },
          metadata: { type: "object", nullable: true, additionalProperties: true },
          todoId: { type: "string" },
          userId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Reminder: {
        type: "object",
        properties: {
          id: { type: "string" },
          remindAt: { type: "string", format: "date-time" },
          channel: { type: "string", enum: ["INAPP", "EMAIL", "PUSH"] },
          sentAt: { type: "string", format: "date-time", nullable: true, description: "When the reminder was dispatched, null if still pending" },
          todoId: { type: "string" },
          userId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreateReminder: {
        type: "object",
        required: ["remindAt"],
        properties: {
          remindAt: { type: "string", format: "date-time", description: "When the reminder should fire" },
          channel: { type: "string", enum: ["INAPP", "EMAIL", "PUSH"], description: "Delivery channel, defaults to INAPP" },
        },
      },
      UpdateReminder: {
        type: "object",
        properties: {
          remindAt: { type: "string", format: "date-time" },
          channel: { type: "string", enum: ["INAPP", "EMAIL", "PUSH"] },
        },
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", description: "e.g. reminder.due" },
          payload: { type: "object", nullable: true, additionalProperties: true },
          read: { type: "boolean" },
          userId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      MarkNotification: {
        type: "object",
        properties: {
          read: { type: "boolean", description: "Target read state; defaults to true" },
        },
      },
      DispatchResult: {
        type: "object",
        properties: {
          dispatched: { type: "integer", description: "How many due reminders were processed" },
          reminderIds: { type: "array", items: { type: "string" } },
        },
      },
      ReminderListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Reminder" } },
        },
      },
      ReminderResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/Reminder" },
        },
      },
      NotificationListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
        },
      },
      NotificationResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/Notification" },
        },
      },
      DispatchResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/DispatchResult" },
        },
      },
      CommentListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Comment" } },
        },
      },
      CommentResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/Comment" },
        },
      },
      AttachmentListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/Attachment" } },
        },
      },
      AttachmentResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { $ref: "#/components/schemas/Attachment" },
        },
      },
      ActivityListResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "array", items: { $ref: "#/components/schemas/ActivityLogEntry" } },
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
