import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export async function prepareGeminiEnv(mcpServerUrl: string, existingHome?: string): Promise<NodeJS.ProcessEnv> {
    try {
        const { tmpdir } = await import('os');
        if (existingHome) {
            await ensureGeminiSettings(existingHome, mcpServerUrl, false);
            return { HOME: existingHome };
        }

        const uniqueId = Math.random().toString(36).substring(7);
        const tempHome = path.join(tmpdir(), `agent-manager-gemini-${uniqueId}`);
        await ensureGeminiSettings(tempHome, mcpServerUrl, true);

        return { HOME: tempHome };
    } catch (error) {
        console.error('[EnvUtils] Failed to prepare Gemini temp env:', error);
        return {};
    }
}

export async function prepareClaudeEnv(mcpServerUrl: string, existingConfigDir?: string): Promise<NodeJS.ProcessEnv> {
    try {
        const { tmpdir } = await import('os');
        if (existingConfigDir) {
            await ensureClaudeSettings(existingConfigDir, mcpServerUrl, false);
            return { CLAUDE_CONFIG_DIR: existingConfigDir };
        }

        const uniqueId = Math.random().toString(36).substring(7);
        const tempConfigDir = path.join(tmpdir(), `agent-manager-claude-${uniqueId}`);
        await ensureClaudeSettings(tempConfigDir, mcpServerUrl, true);

        return { CLAUDE_CONFIG_DIR: tempConfigDir };
    } catch (error) {
        console.error('[EnvUtils] Failed to prepare Claude temp env:', error);
        return {};
    }
}

async function ensureGeminiSettings(
    homeDir: string,
    mcpServerUrl: string,
    copyAuth: boolean
): Promise<void> {
    const settingsDir = path.join(homeDir, '.gemini');
    const settingsFile = path.join(settingsDir, 'settings.json');

    await fs.mkdir(settingsDir, { recursive: true });

    if (copyAuth) {
        const userHome = homedir();
        const userGeminiDir = path.join(userHome, '.gemini');

        const filesToCopy = [
            'oauth_creds.json',
            'google_accounts.json',
            'installation_id',
            'state.json',
            'settings.json'
        ];

        for (const file of filesToCopy) {
            try {
                await fs.copyFile(
                    path.join(userGeminiDir, file),
                    path.join(settingsDir, file)
                );
            } catch (e) {
                // File might not exist, ignore
            }
        }
    }

    let settings: any = { mcpServers: {} };
    try {
        const content = await fs.readFile(settingsFile, 'utf-8');
        settings = JSON.parse(content);
    } catch (e) {
        // If it wasn't there or invalid, we start with empty settings
    }

    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers['agents-manager-mcp'] = { url: mcpServerUrl };

    await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
}

async function ensureClaudeSettings(
    configDir: string,
    mcpServerUrl: string,
    copyAuth: boolean
): Promise<void> {
    const settingsFile = path.join(configDir, 'config.json');

    await fs.mkdir(configDir, { recursive: true });

    if (copyAuth) {
        const userHome = homedir();
        // Claude Code config location on macOS
        let sourceDir = path.join(userHome, 'Library', 'Application Support', 'claude-code');
        if (process.platform === 'win32') {
            sourceDir = path.join(process.env.APPDATA || '', 'claude-code');
        } else if (process.platform === 'linux') {
            sourceDir = path.join(userHome, '.config', 'claude-code');
        }

        const filesToCopy = [
            'config.json',
            'auth.json'
        ];

        for (const file of filesToCopy) {
            try {
                await fs.copyFile(
                    path.join(sourceDir, file),
                    path.join(configDir, file)
                );
            } catch (e) {
                // File might not exist, ignore
            }
        }
    }

    let settings: any = { mcpServers: {} };
    try {
        const content = await fs.readFile(settingsFile, 'utf-8');
        settings = JSON.parse(content);
    } catch (e) {
        // If it wasn't there or invalid, we start with empty settings
    }

    if (!settings.mcpServers) settings.mcpServers = {};
    // Claude Code MCP format for SSE
    settings.mcpServers['agents-manager-mcp'] = {
        type: 'sse',
        url: mcpServerUrl
    };

    await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2));
}
