/**
 * IGtrConfigService - Port interface for GTR configuration management
 *
 * This interface defines the contract for reading and writing
 * .gtrconfig files in project roots.
 */

import type { GtrConfig } from "../types/gtr-config";

export interface IGtrConfigService {
    getGtrConfig(rootPath: string): Promise<GtrConfig>;
    updateGtrConfig(rootPath: string, config: GtrConfig): Promise<void>;
}
