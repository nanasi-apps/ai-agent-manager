import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import type { ToolRegistrar } from "./types";

export function registerFsTools(registerTool: ToolRegistrar) {
	registerTool(
		"read_file",
		{
			description: "Read file contents",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
			},
		},
		async ({ path: pathArg, file_path: filePathArg }) => {
			const filePath =
				(pathArg as string | undefined) || (filePathArg as string | undefined);
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				const content = await fs.readFile(filePath, "utf-8");
				return {
					content: [{ type: "text", text: content }],
				};
			} catch (error: unknown) {
				return {
					content: [
						{
							type: "text",
							text: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"write_file",
		{
			description: "Write content to a file",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
				content: z.string().describe("Content to write"),
			},
		},
		async ({ path: pathArg, file_path: filePathArg, content }) => {
			const filePath =
				(pathArg as string | undefined) || (filePathArg as string | undefined);
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				await fs.mkdir(path.dirname(filePath), { recursive: true });
				await fs.writeFile(filePath, content as string, "utf-8");
				return {
					content: [
						{ type: "text", text: `Successfully wrote to ${filePath}` },
					],
				};
			} catch (error: unknown) {
				return {
					content: [
						{
							type: "text",
							text: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"replace_file_content",
		{
			description: "Replace content in a file",
			inputSchema: {
				path: z.string().describe("Absolute path to the file").optional(),
				file_path: z
					.string()
					.describe("Absolute path to the file (alias)")
					.optional(),
				target: z.string().describe("String to replace"),
				replacement: z.string().describe("New string"),
			},
		},
		async ({ path: pathArg, file_path: filePathArg, target, replacement }) => {
			const filePath =
				(pathArg as string | undefined) || (filePathArg as string | undefined);
			if (!filePath) {
				return {
					content: [
						{ type: "text", text: "Error: path or file_path is required" },
					],
					isError: true,
				};
			}
			try {
				const content = await fs.readFile(filePath, "utf-8");
				if (!content.includes(target as string)) {
					return {
						content: [
							{
								type: "text",
								text: `Target string not found in file: ${filePath}`,
							},
						],
						isError: true,
					};
				}
				const newContent = content.replace(
					target as string,
					replacement as string,
				);
				await fs.writeFile(filePath, newContent, "utf-8");
				return {
					content: [
						{
							type: "text",
							text: `Successfully replaced content in ${filePath}`,
						},
					],
				};
			} catch (error: unknown) {
				return {
					content: [
						{
							type: "text",
							text: `Error replacing content: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	registerTool(
		"pre_file_edit",
		{
			description: "Pre-edit hook for file operations",
			inputSchema: {
				path: z.string().describe("Absolute path to the file"),
				operation: z
					.string()
					.describe("Operation name (write_file, replace_file_content, etc.)"),
				editId: z
					.string()
					.optional()
					.describe("Optional identifier to correlate with post_file_edit"),
			},
		},
		async ({ path: filePath, operation }) => {
			return {
				content: [
					{
						type: "text",
						text: `Pre-edit recorded for ${filePath} (${operation})`,
					},
				],
			};
		},
	);

	registerTool(
		"post_file_edit",
		{
			description: "Post-edit hook for file operations",
			inputSchema: {
				path: z.string().describe("Absolute path to the file"),
				operation: z
					.string()
					.describe("Operation name (write_file, replace_file_content, etc.)"),
				editId: z
					.string()
					.optional()
					.describe("Optional identifier to correlate with pre_file_edit"),
				success: z
					.boolean()
					.optional()
					.describe("Whether the operation succeeded"),
				message: z
					.string()
					.optional()
					.describe("Optional message about the operation outcome"),
			},
		},
		async ({ path: filePath, operation, success, message }) => {
			const status = success === false ? "failed" : "completed";
			const suffix = message ? `: ${message}` : "";
			return {
				content: [
					{
						type: "text",
						text: `Post-edit ${status} for ${filePath} (${operation})${suffix}`,
					},
				],
			};
		},
	);

	registerTool(
		"list_directory",
		{
			description: "List directory contents",
			inputSchema: {
				path: z.string().describe("Absolute path to the directory").optional(),
				dir_path: z
					.string()
					.describe("Absolute path to the directory (alias)")
					.optional(),
			},
		},
		async ({ path: dirPathArg, dir_path: altDirPathArg }) => {
			const dirPath =
				(dirPathArg as string | undefined) ||
				(altDirPathArg as string | undefined);
			if (!dirPath) {
				return {
					content: [
						{ type: "text", text: "Error: path or dir_path is required" },
					],
					isError: true,
				};
			}
			try {
				const files = await fs.readdir(dirPath);
				return {
					content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
				};
			} catch (error: unknown) {
				return {
					content: [
						{
							type: "text",
							text: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
