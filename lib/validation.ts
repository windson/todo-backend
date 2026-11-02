import { z } from "zod/v4";

export const PriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const RecurrenceRuleEnum = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);

export const CreateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title must be 255 characters or less"),
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
  completed: z.boolean().optional(),
  priority: PriorityEnum.optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  recurrenceRule: RecurrenceRuleEnum.optional(),
  recurrenceInterval: z.number().int().min(1, "Recurrence interval must be at least 1").max(365, "Recurrence interval must be 365 or less").optional(),
  categoryId: z.string().optional(),
  parentId: z.string().optional(),
  order: z.number().int().optional(),
  tagIds: z.array(z.string()).optional(),
});

export const UpdateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title must be 255 characters or less").optional(),
  description: z.string().max(1000, "Description must be 1000 characters or less").nullable().optional(),
  completed: z.boolean().optional(),
  priority: PriorityEnum.optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  recurrenceRule: RecurrenceRuleEnum.nullable().optional(),
  recurrenceInterval: z.number().int().min(1, "Recurrence interval must be at least 1").max(365, "Recurrence interval must be 365 or less").optional(),
  categoryId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  order: z.number().int().optional(),
  tagIds: z.array(z.string()).optional(),
});

export const CreateCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  color: z.string().min(1, "Color is required").max(7, "Color must be a valid hex color").regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color (e.g. #ff0000)"),
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less").optional(),
  color: z.string().min(1, "Color is required").max(7, "Color must be a valid hex color").regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color (e.g. #ff0000)").optional(),
});

export const CreateTagSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less"),
  color: z.string().min(1, "Color is required").max(7, "Color must be a valid hex color").regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color (e.g. #ff0000)"),
});

export const UpdateTagSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name must be 100 characters or less").optional(),
  color: z.string().min(1, "Color is required").max(7, "Color must be a valid hex color").regex(/^#[0-9a-fA-F]{6}$/, "Color must be a valid hex color (e.g. #ff0000)").optional(),
});

export const SignupSchema = z.object({
  email: z.email("A valid email is required").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password must be 128 characters or less"),
  name: z.string().min(1).max(100, "Name must be 100 characters or less").optional(),
});

export const LoginSchema = z.object({
  email: z.email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});

export const TodoQueryParamsSchema = z.object({
  search: z.string().optional(),
  completed: z.enum(["true", "false"]).optional(),
  priority: z.string().optional(),
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  parentId: z.string().optional(),
  includeSubtasks: z.enum(["true", "false"]).optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  dueFilter: z.enum(["today", "upcoming", "overdue"]).optional(),
  sortBy: z.enum(["createdAt", "dueDate", "priority", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const CreateAttachmentSchema = z.object({
  filename: z.string().min(1, "Filename is required").max(255, "Filename must be 255 characters or less"),
  url: z.string().min(1, "URL is required").max(2048, "URL must be 2048 characters or less").refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    "URL must be a valid http(s) URL",
  ),
  mimeType: z.string().max(255, "MIME type must be 255 characters or less").optional(),
  size: z.number().int().min(0, "Size must be zero or greater").max(5_000_000_000, "Size is too large").optional(),
});

export const CreateCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required").max(2000, "Comment must be 2000 characters or less"),
});

export const UpdateCommentSchema = z.object({
  body: z.string().min(1, "Comment body is required").max(2000, "Comment must be 2000 characters or less"),
});

export const ReminderChannelEnum = z.enum(["INAPP", "EMAIL", "PUSH"]);

export const CreateReminderSchema = z.object({
  remindAt: z.coerce.date(),
  channel: ReminderChannelEnum.optional(),
});

export const UpdateReminderSchema = z.object({
  remindAt: z.coerce.date().optional(),
  channel: ReminderChannelEnum.optional(),
});

export const NotificationQueryParamsSchema = z.object({
  read: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const MarkNotificationSchema = z.object({
  read: z.boolean().optional(),
});

export const BulkOperationSchema = z.object({
  operation: z.enum(["complete", "uncomplete", "delete"]),
  ids: z.array(z.string()).min(1, "At least one ID is required").max(50, "Cannot process more than 50 items at once"),
});

export const TodoTagsSchema = z.object({
  tagIds: z.array(z.string()).min(1, "At least one tag ID is required"),
});

export const RemoveTagSchema = z.object({
  tagId: z.string().min(1, "Tag ID is required"),
});

export type RecurrenceRuleInput = z.infer<typeof RecurrenceRuleEnum>;
export type CreateTodoInput = z.infer<typeof CreateTodoSchema>;
export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
export type TodoQueryParams = z.infer<typeof TodoQueryParamsSchema>;
export type BulkOperationInput = z.infer<typeof BulkOperationSchema>;
export type CreateAttachmentInput = z.infer<typeof CreateAttachmentSchema>;
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
export type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;
export type ReminderChannelInput = z.infer<typeof ReminderChannelEnum>;
export type CreateReminderInput = z.infer<typeof CreateReminderSchema>;
export type UpdateReminderInput = z.infer<typeof UpdateReminderSchema>;
export type NotificationQueryParams = z.infer<typeof NotificationQueryParamsSchema>;
export type MarkNotificationInput = z.infer<typeof MarkNotificationSchema>;
export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
