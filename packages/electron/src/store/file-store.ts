import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Conversation, Message, Project, IStore } from '@agent-manager/shared';
import { normalizeMessages, StoreData, tryMergeMessage } from './serialization';

/**
 * File-based persistent store
 * Uses Electron's userData path for persistence
 */
export class FileStore implements IStore {
    private conversations: Map<string, Conversation> = new Map();
    private projects: Map<string, Project> = new Map();
    private dataPath: string | null = null;
    private saveTimeout: ReturnType<typeof setTimeout> | null = null;

    setDataPath(dirPath: string) {
        this.dataPath = path.join(dirPath, 'conversations.json');
        this.load();
    }

    private load() {
        if (!this.dataPath) return;

        try {
            if (fs.existsSync(this.dataPath)) {
                const raw = fs.readFileSync(this.dataPath, 'utf-8');
                const data: StoreData = JSON.parse(raw);
                this.conversations.clear();

                for (const conv of data.conversations) {
                    // Normalize existing messages by merging fragments
                    if (conv.messages) {
                        conv.messages = normalizeMessages(conv.messages);
                    } else {
                        conv.messages = [];
                    }

                    this.conversations.set(conv.id, conv);
                }

                if (data.projects) {
                    this.projects.clear();
                    for (const proj of data.projects) {
                        this.projects.set(proj.id, proj);
                    }
                }

                console.log(`[FileStore] Loaded ${this.conversations.size} conversations and ${this.projects.size} projects from ${this.dataPath}`);
                this.scheduleSave();
            }
        } catch (err) {
            console.error('[FileStore] Failed to load data:', err);
        }
    }

    private scheduleSave() {
        if (!this.dataPath) return;

        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        this.saveTimeout = setTimeout(() => {
            this.saveSync();
        }, 500);
    }

    private saveSync() {
        if (!this.dataPath) return;

        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const data: StoreData = {
                conversations: Array.from(this.conversations.values()),
                projects: Array.from(this.projects.values())
            };
            fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[FileStore] Saved ${this.conversations.size} conversations to ${this.dataPath}`);
        } catch (err) {
            console.error('[FileStore] Failed to save data:', err);
        }
    }

    addConversation(conversation: Conversation) {
        this.conversations.set(conversation.id, conversation);
        this.scheduleSave();
    }

    getConversation(id: string): Conversation | undefined {
        return this.conversations.get(id);
    }

    listConversations(projectId?: string): Conversation[] {
        const all = Array.from(this.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt);
        if (projectId) {
            return all.filter(c => c.projectId === projectId);
        }
        return all;
    }

    updateConversation(id: string, updates: Partial<Conversation>) {
        const existing = this.conversations.get(id);
        if (existing) {
            this.conversations.set(id, {
                ...existing,
                ...updates,
                updatedAt: Date.now()
            });
            this.scheduleSave();
        }
    }

    addMessage(conversationId: string, message: Message) {
        const conv = this.conversations.get(conversationId);
        if (conv) {
            const lastMsg = conv.messages[conv.messages.length - 1];

            // Try to merge with the last message if compatible
            const merged = tryMergeMessage(lastMsg, message);

            if (!merged) {
                conv.messages.push(message);
            }

            conv.updatedAt = Date.now();
            this.scheduleSave();
        }
    }

    getMessages(conversationId: string): Message[] {
        const conv = this.conversations.get(conversationId);
        return conv?.messages || [];
    }

    deleteConversation(id: string) {
        this.conversations.delete(id);
        this.scheduleSave();
    }

    addProject(project: Project) {
        this.projects.set(project.id, project);
        this.scheduleSave();
    }

    getProject(id: string): Project | undefined {
        return this.projects.get(id);
    }

    listProjects(): Project[] {
        return Array.from(this.projects.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    updateProject(id: string, updates: Partial<Project>) {
        const existing = this.projects.get(id);
        if (existing) {
            this.projects.set(id, {
                ...existing,
                ...updates,
                updatedAt: Date.now(),
            });
            this.scheduleSave();
        }
    }

    deleteProject(id: string) {
        this.projects.delete(id);
        this.scheduleSave();
    }
}

export const store = new FileStore();
