/**
 * IHandoverService - Port interface for agent handover/summary generation
 *
 * This interface defines the contract for generating summaries
 * when handing over context between agents or sessions.
 */

import type { SummaryOptions } from "../types/agent";

export interface IHandoverService {
    generateAgentSummary(options: SummaryOptions): Promise<string | null>;
}
