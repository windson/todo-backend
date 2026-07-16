import { z } from "zod/v4";

export const PriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const CreateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title must be 255 characters or less"),
  description: z.string().max(1000, "Description must be 1000 characters or less").optional(),
  completed: z.boolean().optional(),
  priority: PriorityEnum.optional(),
  dueDate: z.coerce.date().optional(),
  categoryId: z.string().optional(),
  order: z.number().int().optional(),
  tagIds: z.array(z.string()).optional(),
});

export const UpdateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(255, "Title must be 255 characters or less").optional(),
  description: z.string().max(1000, "Description must be 1000 characters or less").nullable().optional(),
  completed: z.boolean().optional(),
  priority: PriorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  categoryId: z.string().nullable().optional(),
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

export const TodoQueryParamsSchema = z.object({
  search: z.string().optional(),
  completed: z.enum(["true", "false"]).optional(),
  priority: z.string().optional(),
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  sortBy: z.enum(["createdAt", "dueDate", "priority", "title"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
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

export type CreateTodoInput = z.infer<typeof CreateTodoSchema>;
export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
export type CreateTagInput = z.infer<typeof CreateTagSchema>;
export type UpdateTagInput = z.infer<typeof UpdateTagSchema>;
export type TodoQueryParams = z.infer<typeof TodoQueryParamsSchema>;
export type BulkOperationInput = z.infer<typeof BulkOperationSchema>;
