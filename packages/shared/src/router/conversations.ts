import { os } from "@orpc/server";
import { z } from "zod";
import { spawn } from "node:child_process";
import { getStoreOrThrow, getAgentManagerOrThrow } from "../services/dependency-container";
import { resolveProjectRules } from "../services/rules-resolver";
import { parseModelId } from "../services/model-fetcher";
import { generateUUID } from "../utils";
import { getAgentTemplate } from "../types/project";
import {
    buildHandoverContext,
    HANDOVER_SUMMARY_PROMPT,
} from "../templates/handover-templates";

export const conversationsRouter = {
    createConversation: os
        .input(z.object({
            projectId: z.string(),
            initialMessage: z.string(),
            modelId: z.string().optional(),
            agentType: z.string().optional(),
            agentModel: z.string().optional(),
        }))
        .output(z.object({
            sessionId: z.string(),
        }))
        .handler(async ({ input }) => {
            const sessionId = generateUUID();
            const now = Date.now();
            const storeInstance = getStoreOrThrow();
            const agentManagerInstance = getAgentManagerOrThrow();

            // Verify project exists
            const project = storeInstance.getProject(input.projectId);
            if (!project) {
                throw new Error(`Project not found: ${input.projectId}`);
            }

            const parsedModel = input.modelId ? parseModelId(input.modelId) : null;
            const resolvedAgentType = parsedModel?.agentType || input.agentType;

            if (!resolvedAgentType) {
                throw new Error('Model or agent type is required.');
            }

            // Get Agent Template
            const agentTemplate = getAgentTemplate(resolvedAgentType);
            if (!agentTemplate) {
                throw new Error(`Agent type not found: ${resolvedAgentType}`);
            }
            const resolvedModel = parsedModel?.model || input.agentModel;

            // Determine the cwd for the agent
            const agentCwd = project.rootPath || agentTemplate.agent.cwd;

            // Save to store with initialMessage and messages array
            storeInstance.addConversation({
                id: sessionId,
                projectId: input.projectId,
                title: input.initialMessage.slice(0, 30) || "New Conversation",
                initialMessage: input.initialMessage,
                createdAt: now,
                updatedAt: now,
                agentType: resolvedAgentType,
                agentModel: resolvedModel,
                cwd: agentCwd,
                messages: [{
                    id: generateUUID(),
                    role: 'user',
                    content: input.initialMessage,
                    timestamp: now,
                }]
            });

            if (!agentManagerInstance.isRunning(sessionId)) {
                console.log(`Starting agent for project ${input.projectId} (Session: ${sessionId})`);
                console.log(`Command: ${agentTemplate.agent.command}`);

                const rulesContent = await resolveProjectRules(input.projectId);

                // Build environment variables with API credentials
                const apiSettings = storeInstance.getApiSettings();
                const agentEnv: Record<string, string> = {};

                // For Codex/OpenAI CLI
                if (agentTemplate.agent.type === 'codex') {
                    if (apiSettings.openaiApiKey) {
                        agentEnv.OPENAI_API_KEY = apiSettings.openaiApiKey;
                    }
                    if (apiSettings.openaiBaseUrl) {
                        agentEnv.OPENAI_BASE_URL = apiSettings.openaiBaseUrl;
                    }
                }

                // For Gemini CLI
                if (agentTemplate.agent.type === 'gemini') {
                    if (apiSettings.geminiApiKey) {
                        agentEnv.GEMINI_API_KEY = apiSettings.geminiApiKey;
                    }
                    if (apiSettings.geminiBaseUrl) {
                        agentEnv.GOOGLE_GEMINI_BASE_URL = apiSettings.geminiBaseUrl;
                    }
                }

                agentManagerInstance.startSession(sessionId, agentTemplate.agent.command, {
                    ...agentTemplate.agent,
                    model: resolvedModel,
                    cwd: agentCwd,
                    rulesContent,
                    env: { ...agentTemplate.agent.env, ...agentEnv },
                });
            }

            agentManagerInstance.sendToSession(sessionId, input.initialMessage);

            return { sessionId };
        }),

    getConversation: os
        .input(z.object({ sessionId: z.string() }))
        .output(z.object({
            id: z.string(),
            projectId: z.string(),
            title: z.string(),
            initialMessage: z.string(),
            createdAt: z.number(),
            updatedAt: z.number(),
            agentType: z.string().optional(),
            agentModel: z.string().optional(),
            cwd: z.string().optional(),
        }).nullable())
        .handler(async ({ input }) => {
            const conv = getStoreOrThrow().getConversation(input.sessionId);
            if (!conv) return null;
            return conv;
        }),

    updateConversationTitle: os
        .input(z.object({
            sessionId: z.string(),
            title: z.string().min(1).max(120),
        }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const conv = storeInstance.getConversation(input.sessionId);
            if (!conv) return { success: false };
            storeInstance.updateConversation(input.sessionId, {
                title: input.title,
            });
            return { success: true };
        }),

    sendMessage: os
        .input(z.object({
            sessionId: z.string(),
            message: z.string(),
        }))
        .output(z.object({
            success: z.boolean(),
        }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const agentManagerInstance = getAgentManagerOrThrow();

            if (!agentManagerInstance.isRunning(input.sessionId)) {
                const conv = storeInstance.getConversation(input.sessionId);
                if (!conv) {
                    return { success: false };
                }

                const agentTemplate = getAgentTemplate(conv.agentType || 'gemini');
                if (!agentTemplate) {
                    console.error("Agent template not found for legacy/missing type");
                    return { success: false };
                }

                const project = storeInstance.getProject(conv.projectId);
                const cwd = project?.rootPath || agentTemplate.agent.cwd;

                console.warn(`Session ${input.sessionId} not found, restarting with command: ${agentTemplate.agent.command}`);

                const rulesContent = await resolveProjectRules(conv.projectId);

                // Build environment variables with API credentials
                const apiSettings = storeInstance.getApiSettings();
                const agentEnv: Record<string, string> = {};

                // For Codex/OpenAI CLI
                if (agentTemplate.agent.type === 'codex') {
                    if (apiSettings.openaiApiKey) {
                        agentEnv.OPENAI_API_KEY = apiSettings.openaiApiKey;
                    }
                    if (apiSettings.openaiBaseUrl) {
                        agentEnv.OPENAI_BASE_URL = apiSettings.openaiBaseUrl;
                    }
                }

                // For Gemini CLI
                if (agentTemplate.agent.type === 'gemini') {
                    if (apiSettings.geminiApiKey) {
                        agentEnv.GEMINI_API_KEY = apiSettings.geminiApiKey;
                    }
                    if (apiSettings.geminiBaseUrl) {
                        agentEnv.GOOGLE_GEMINI_BASE_URL = apiSettings.geminiBaseUrl;
                    }
                }

                agentManagerInstance.startSession(input.sessionId, agentTemplate.agent.command, {
                    ...agentTemplate.agent,
                    model: conv.agentModel,
                    cwd,
                    rulesContent,
                    env: { ...agentTemplate.agent.env, ...agentEnv },
                });
            }

            // Save the user message to store
            storeInstance.addMessage(input.sessionId, {
                id: generateUUID(),
                role: 'user',
                content: input.message,
                timestamp: Date.now(),
            });

            const pendingHandover = agentManagerInstance.consumePendingHandover(input.sessionId);
            const messageToSend = pendingHandover ? `${pendingHandover}\n${input.message}` : input.message;

            agentManagerInstance.sendToSession(input.sessionId, messageToSend);

            return { success: true };
        }),

    stopSession: os
        .input(z.object({ sessionId: z.string() }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const success = getAgentManagerOrThrow().stopSession(input.sessionId);
            if (success) {
                storeInstance.addMessage(input.sessionId, {
                    id: generateUUID(),
                    role: 'system',
                    content: 'Generation stopped by user.',
                    timestamp: Date.now(),
                    logType: 'system',
                });
            }
            return { success };
        }),

    getMessages: os
        .input(z.object({ sessionId: z.string() }))
        .output(z.array(z.object({
            id: z.string(),
            role: z.enum(['user', 'agent', 'system']),
            content: z.string(),
            timestamp: z.number(),
            logType: z.enum(['text', 'tool_call', 'tool_result', 'thinking', 'error', 'system']).optional(),
        })))
        .handler(async ({ input }) => {
            return getStoreOrThrow().getMessages(input.sessionId);
        }),

    addMessage: os
        .input(z.object({
            sessionId: z.string(),
            role: z.enum(['user', 'agent', 'system']),
            content: z.string(),
            logType: z.enum(['text', 'tool_call', 'tool_result', 'thinking', 'error', 'system']).optional(),
        }))
        .output(z.object({ success: z.boolean() }))
        .handler(async ({ input }) => {
            getStoreOrThrow().addMessage(input.sessionId, {
                id: generateUUID(),
                role: input.role,
                content: input.content,
                timestamp: Date.now(),
                logType: input.logType,
            });
            return { success: true };
        }),

    listConversations: os
        .input(z.object({
            projectId: z.string().optional()
        }))
        .output(z.array(z.object({
            id: z.string(),
            projectId: z.string(),
            title: z.string(),
            createdAt: z.number(),
            updatedAt: z.number(),
            agentType: z.string().optional(),
        })))
        .handler(async ({ input }) => {
            return getStoreOrThrow().listConversations(input.projectId);
        }),

    swapConversationAgent: os
        .input(z.object({
            sessionId: z.string(),
            modelId: z.string().optional(),
            agentType: z.string().optional(),
            agentModel: z.string().optional(),
        }))
        .output(z.object({
            success: z.boolean(),
            message: z.string().optional(),
        }))
        .handler(async ({ input }) => {
            const storeInstance = getStoreOrThrow();
            const agentManagerInstance = getAgentManagerOrThrow();

            const conv = storeInstance.getConversation(input.sessionId);
            if (!conv) {
                return { success: false, message: `Conversation not found: ${input.sessionId}` };
            }

            const parsedModel = input.modelId ? parseModelId(input.modelId) : null;
            const resolvedAgentType = parsedModel?.agentType || input.agentType;

            if (!resolvedAgentType) {
                return { success: false, message: 'Model or agent type is required.' };
            }

            const nextTemplate = getAgentTemplate(resolvedAgentType);
            if (!nextTemplate) {
                return { success: false, message: `Agent type not found: ${resolvedAgentType}` };
            }

            const currentTemplate = conv.agentType ? getAgentTemplate(conv.agentType) : undefined;
            const sameCli = currentTemplate?.agent.type === nextTemplate.agent.type;
            const resolvedModel = parsedModel?.model || input.agentModel;
            const nextModelLabel = resolvedModel;

            const project = storeInstance.getProject(conv.projectId);
            const cwd = project?.rootPath || nextTemplate.agent.cwd;

            const previousName = currentTemplate?.name || conv.agentType || 'unknown';
            const label = nextModelLabel || nextTemplate.name;
            const systemMessage = `Switched agent from ${previousName} to ${label}.`;

            storeInstance.updateConversation(input.sessionId, {
                agentType: resolvedAgentType,
                agentModel: resolvedModel,
            });

            storeInstance.addMessage(input.sessionId, {
                id: generateUUID(),
                role: 'system',
                content: systemMessage,
                timestamp: Date.now(),
                logType: 'system',
            });

            // Helper to get summary from an agent process
            async function getAgentSummary(agentType: string, context: string, metadata?: { geminiSessionId?: string; codexThreadId?: string }): Promise<string | null> {
                return new Promise((resolve) => {
                    let command = '';
                    let args: string[] = [];
                    const prompt = HANDOVER_SUMMARY_PROMPT;

                    // Determine command based on agent type
                    if (agentType === 'codex' && metadata?.codexThreadId) {
                        command = 'codex';
                        args = ['exec', 'resume', '-m', 'gpt-5.2', metadata.codexThreadId, prompt];
                    } else if (agentType === 'gemini' && metadata?.geminiSessionId) {
                        command = 'gemini';
                        args = ['--resume', metadata.geminiSessionId, '-y', prompt];
                    } else if (agentType === 'claude') {
                        command = 'claude';
                        args = ['-p', prompt];
                    } else {
                        if (agentType === 'codex') {
                            command = 'codex';
                            args = ['exec', '-m', 'gpt-5.2', prompt];
                        } else if (agentType === 'gemini') {
                            command = 'gemini';
                            args = ['-y', prompt];
                        } else {
                            return resolve(null);
                        }
                    }

                    console.log(`[ConversationsRouter] Generating summary with: ${command} ${args.join(' ')}`);

                    try {
                        const child = spawn(command, args, {
                            cwd,
                            env: process.env,
                            stdio: ['pipe', 'pipe', 'pipe'],
                            shell: true,
                        });

                        let output = '';
                        let stderrOutput = '';

                        child.stderr.on('data', (data) => {
                            stderrOutput += data.toString();
                        });

                        const isResuming = args.includes('resume') || args.includes('--resume');
                        if (!isResuming) {
                            child.stdin.write(context);
                        }
                        child.stdin.end();

                        child.stdout.on('data', (data) => {
                            output += data.toString();
                        });

                        child.on('close', (code) => {
                            if (code === 0 && output.trim()) {
                                resolve(output.trim());
                            } else {
                                console.warn(`[ConversationsRouter] Summary generation failed/empty with code ${code}`);
                                if (stderrOutput.trim()) {
                                    console.warn(`[ConversationsRouter] Summary stderr: ${stderrOutput.trim()}`);
                                }
                                if (output.trim()) {
                                    console.warn(`[ConversationsRouter] Summary stdout: ${output.trim().slice(0, 200)}`);
                                }
                                resolve(null);
                            }
                        });

                        child.on('error', (err) => {
                            console.error(`[ConversationsRouter] Summary generation error: ${err}`);
                            resolve(null);
                        });
                    } catch (e) {
                        console.error(`[ConversationsRouter] Summary generation exception: ${e}`);
                        resolve(null);
                    }
                });
            }

            function summarizeContent(content: string): string {
                const limit = 300;
                const clean = content.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                if (clean.length <= limit) return clean;
                return clean.slice(0, limit) + '... (truncated)';
            }

            // Prepare context handover data BEFORE resetting the session
            let handoverSummary: string | null = null;
            let handoverPreviousName = '';

            if (!sameCli) {
                const pastMessages = storeInstance.getMessages(input.sessionId);
                const recent = pastMessages
                    .filter(m => (m.role === 'user' || m.role === 'agent') && (!m.logType || m.logType === 'text'))
                    .slice(-20);

                if (recent.length > 0) {
                    const historyText = recent.map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`).join('\n\n');
                    handoverPreviousName = currentTemplate?.name || conv.agentType || 'unknown';

                    // Get metadata BEFORE resetSession clears it
                    const metadata = agentManagerInstance.getSessionMetadata(input.sessionId);

                    // Generate summary using the previous agent's context (if possible)
                    handoverSummary = await getAgentSummary(conv.agentType || 'gemini', historyText, metadata);

                    // Fallback to simple truncation if smart summary failed
                    if (!handoverSummary) {
                        handoverSummary = recent.map(m => {
                            const role = m.role === 'user' ? 'User' : 'Agent';
                            return `- ${role}: ${summarizeContent(m.content)}`;
                        }).join('\n');
                    }
                }
            }

            // NOW reset the session after we've captured the metadata
            agentManagerInstance.resetSession(input.sessionId, nextTemplate.agent.command, {
                ...nextTemplate.agent,
                model: resolvedModel,
                cwd,
            });

            // Store handover context to prepend to next user message (if we have one)
            if (handoverSummary) {
                const handoverContext = buildHandoverContext(
                    handoverPreviousName,
                    handoverSummary,
                );
                agentManagerInstance.setPendingHandover(input.sessionId, handoverContext);
            }

            return { success: true, message: systemMessage };
        }),
};
