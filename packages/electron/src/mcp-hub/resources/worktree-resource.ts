import { createHash } from "node:crypto";
import type { McpResource, McpResourceContent, McpResourceTemplate, McpResourceUpdate } from "@agent-manager/shared";
import { InternalToolProvider } from "../types";
import { store } from "../../store";
import { worktreeManager } from "../../main/worktree-manager";

type WorktreeLookup = {
    branch: string;
    repoPath?: string;
    projectId?: string;
    resourceType: "metadata" | "diff" | "status";
};

function unique(values: string[]): string[] {
    return Array.from(new Set(values));
}

function encodeSegment(value: string): string {
    return encodeURIComponent(value);
}

function decodeSegment(value: string): string {
    return decodeURIComponent(value);
}

function buildUri(branch: string, suffix?: "diff" | "status", repoPath?: string): string {
    const encodedBranch = encodeSegment(branch);
    const base = `mcp://worktree/${encodedBranch}`;
    const path = suffix ? `${base}/${suffix}` : base;
    if (!repoPath) return path;
    const query = new URLSearchParams({ repoPath }).toString();
    return `${path}?${query}`;
}

function parseWorktreeUri(uri: string): WorktreeLookup {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        throw new Error(`Invalid worktree resource URI: ${uri}`);
    }

    if (url.protocol !== "mcp:" || url.hostname !== "worktree") {
        throw new Error(`Unsupported worktree resource URI: ${uri}`);
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
        throw new Error(`Worktree resource URI missing branch segment: ${uri}`);
    }

    const branch = decodeSegment(segments[0]);
    const resourceType = segments[1] === "diff"
        ? "diff"
        : segments[1] === "status"
            ? "status"
            : "metadata";
    const repoPath = url.searchParams.get("repoPath") ?? undefined;
    const projectId = url.searchParams.get("projectId") ?? undefined;

    return { branch, repoPath, projectId, resourceType };
}

async function listProjectRoots(): Promise<string[]> {
    const projects = store.listProjects();
    const roots = projects.map((project) => project.rootPath).filter(Boolean) as string[];
    return unique(roots);
}

export class WorktreeResourceProvider implements InternalToolProvider {
    async listTools() {
        return [];
    }

    async callTool(_name: string, _args: any): Promise<any> {
        throw new Error("WorktreeResourceProvider does not support tools.");
    }

    async listResources(): Promise<McpResource[]> {
        const resources: McpResource[] = [];
        const roots = await listProjectRoots();

        for (const repoPath of roots) {
            try {
                const worktrees = await worktreeManager.getWorktrees(repoPath);
                for (const wt of worktrees) {
                    resources.push({
                        uri: buildUri(wt.branch, undefined, repoPath),
                        name: `Worktree ${wt.branch}`,
                        description: `Worktree metadata for ${wt.branch} (${wt.path})`,
                        mimeType: "application/json",
                        serverName: "agents-manager-mcp"
                    });
                    resources.push({
                        uri: buildUri(wt.branch, "diff", repoPath),
                        name: `Worktree diff ${wt.branch}`,
                        description: `Current diff for ${wt.branch}`,
                        mimeType: "text/plain",
                        serverName: "agents-manager-mcp"
                    });
                    resources.push({
                        uri: buildUri(wt.branch, "status", repoPath),
                        name: `Worktree status ${wt.branch}`,
                        description: `Git status for ${wt.branch}`,
                        mimeType: "application/json",
                        serverName: "agents-manager-mcp"
                    });
                }
            } catch (error) {
                console.warn(`[WorktreeResourceProvider] Failed to list worktrees for ${repoPath}`, error);
            }
        }

        return resources;
    }

    async listResourceTemplates(): Promise<McpResourceTemplate[]> {
        return [
            {
                uriTemplate: "mcp://worktree/{branch}",
                name: "Worktree metadata",
                description: "Metadata for a worktree branch",
                mimeType: "application/json",
                serverName: "agents-manager-mcp"
            },
            {
                uriTemplate: "mcp://worktree/{branch}/diff",
                name: "Worktree diff",
                description: "Current diff for a worktree branch",
                mimeType: "text/plain",
                serverName: "agents-manager-mcp"
            },
            {
                uriTemplate: "mcp://worktree/{branch}/status",
                name: "Worktree status",
                description: "Git status for a worktree branch",
                mimeType: "application/json",
                serverName: "agents-manager-mcp"
            }
        ];
    }

    async readResource(uri: string): Promise<McpResourceContent> {
        const lookup = parseWorktreeUri(uri);
        const targetRoots = lookup.repoPath
            ? [lookup.repoPath]
            : lookup.projectId
                ? store.listProjects().filter((project) => project.id === lookup.projectId).map((project) => project.rootPath).filter(Boolean) as string[]
                : await listProjectRoots();

        if (targetRoots.length === 0) {
            throw new Error("No project roots available for worktree lookup.");
        }

        const matches: Array<{ repoPath: string; worktree: Awaited<ReturnType<typeof worktreeManager.getWorktrees>>[number] }> = [];

        for (const repoPath of targetRoots) {
            try {
                const worktrees = await worktreeManager.getWorktrees(repoPath);
                const match = worktrees.find((wt) => wt.branch === lookup.branch);
                if (match) {
                    matches.push({ repoPath, worktree: match });
                }
            } catch (error) {
                console.warn(`[WorktreeResourceProvider] Failed to read worktrees for ${repoPath}`, error);
            }
        }

        if (matches.length === 0) {
            throw new Error(`Worktree not found for branch ${lookup.branch}`);
        }

        if (matches.length > 1) {
            const roots = matches.map((match) => match.repoPath).join(", ");
            throw new Error(`Multiple worktrees match branch ${lookup.branch}. Use ?repoPath= to disambiguate. Matches: ${roots}`);
        }

        const { repoPath, worktree } = matches[0];

        if (lookup.resourceType === "diff") {
            const diff = await worktreeManager.getWorktreeDiff(worktree.path);
            let text = diff.text;
            if (diff.untracked.length > 0) {
                text = `${text}\n\n# Untracked\n${diff.untracked.join("\n")}`.trim();
            }
            return {
                uri,
                mimeType: "text/plain",
                text: text
            };
        }

        if (lookup.resourceType === "status") {
            const status = await worktreeManager.getWorktreeStatus(worktree.path);
            return {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(status, null, 2)
            };
        }

        const metadata = {
            branch: worktree.branch,
            path: worktree.path,
            repoPath,
            isMain: worktree.isMain,
            isLocked: worktree.isLocked,
            prunable: worktree.prunable
        };

        return {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(metadata, null, 2)
        };
    }

    async subscribeResource(
        uri: string,
        onUpdate: (update: McpResourceUpdate) => void
    ): Promise<() => void> {
        let active = true;
        let lastHash = "";
        const pollIntervalMs = 2000;

        const poll = async () => {
            if (!active) return;
            const content = await this.readResource(uri);
            const payload = content.text ?? content.blob ?? "";
            const hash = createHash("sha1").update(payload).digest("hex");
            if (hash !== lastHash) {
                lastHash = hash;
                onUpdate({ uri, content });
            }
        };

        await poll();
        const timer = setInterval(() => {
            poll().catch((error) => {
                console.warn(`[WorktreeResourceProvider] Failed to poll ${uri}`, error);
            });
        }, pollIntervalMs);

        return () => {
            active = false;
            clearInterval(timer);
        };
    }
}
