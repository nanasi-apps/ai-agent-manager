import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { McpServerConfig } from '@agent-manager/shared';

const CONFIG_FILENAME = 'mcp.json';

export interface McpConfig {
    servers: McpServerConfig[];
}

export function getMcpConfigPath(): string {
    const userDataPath = path.join(app.getPath('userData'), CONFIG_FILENAME);
    
    // Check userData first
    if (fs.existsSync(userDataPath)) {
        return userDataPath;
    }

    // Check CWD (useful for dev)
    const cwdPath = path.join(process.cwd(), CONFIG_FILENAME);
    if (fs.existsSync(cwdPath)) {
        return cwdPath;
    }

    // Default to userData if nowhere else found
    return userDataPath;
}

export function loadMcpConfig(): McpConfig {
    const configPath = getMcpConfigPath();
    console.log(`[McpConfig] Loading config from: ${configPath}`);

    try {
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            try {
                const config = JSON.parse(raw);
                // specific validation could be added here
                if (!config.servers || !Array.isArray(config.servers)) {
                    console.warn('[McpConfig] Invalid config format (missing servers array), resetting to default.');
                    return { servers: [] };
                }
                console.log(`[McpConfig] Loaded ${config.servers.length} servers.`);
                return config;
            } catch (parseError) {
                console.error(`[McpConfig] JSON parse error in ${configPath}:`, parseError);
                return { servers: [] };
            }
        } else {
            console.log(`[McpConfig] No config file found at ${configPath}`);
        }
    } catch (error) {
        console.error(`[McpConfig] Failed to load config from ${configPath}:`, error);
    }
    return { servers: [] };
}

export function saveMcpConfig(config: McpConfig): void {
    // Always save to userData to avoid polluting project root in production
    const configPath = path.join(app.getPath('userData'), CONFIG_FILENAME);
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[McpConfig] Saved config to ${configPath}`);
    } catch (error) {
        console.error(`[McpConfig] Failed to save config to ${configPath}:`, error);
    }
}
