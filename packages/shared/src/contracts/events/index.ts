/**
 * Typed Events - Event definitions for agent sessions and system events
 *
 * These typed events are the contract between Session Runtime and UI.
 * The runtime emits these events; UI subscribes and renders them.
 *
 * This supports Milestone 6: "Unify Session Runtime around typed events"
 */

import type { AgentLogPayload, AgentStatePayload } from "../../types/agent";

/**
 * Base event interface - all events extend this
 */
export interface BaseEvent {
    /** Unique event ID */
    id: string;
    /** ISO timestamp when the event was created */
    timestamp: string;
    /** Session ID this event belongs to */
    sessionId: string;
}

/**
 * Log event - text output from agents
 */
export interface LogEvent extends BaseEvent {
    type: "log";
    payload: AgentLogPayload;
}

/**
 * State change event - agent state machine transitions
 */
export interface StateChangeEvent extends BaseEvent {
    type: "state-change";
    payload: AgentStatePayload;
}

/**
 * Tool call event - agent is calling a tool
 */
export interface ToolCallEvent extends BaseEvent {
    type: "tool-call";
    payload: {
        toolName: string;
        arguments: Record<string, unknown>;
    };
}

/**
 * Tool result event - result from a tool execution
 */
export interface ToolResultEvent extends BaseEvent {
    type: "tool-result";
    payload: {
        toolName: string;
        result: unknown;
        success: boolean;
        error?: string;
    };
}

/**
 * Thinking event - agent is reasoning/thinking
 */
export interface ThinkingEvent extends BaseEvent {
    type: "thinking";
    payload: {
        content: string;
    };
}

/**
 * Error event - an error occurred
 */
export interface ErrorEvent extends BaseEvent {
    type: "error";
    payload: {
        message: string;
        code?: string;
        details?: unknown;
    };
}

/**
 * Session lifecycle event - session started/stopped/paused
 */
export interface SessionLifecycleEvent extends BaseEvent {
    type: "session-lifecycle";
    payload: {
        action: "started" | "stopped" | "paused" | "resumed" | "reset";
        reason?: string;
    };
}

/**
 * Union type of all session events
 */
export type SessionEvent =
    | LogEvent
    | StateChangeEvent
    | ToolCallEvent
    | ToolResultEvent
    | ThinkingEvent
    | ErrorEvent
    | SessionLifecycleEvent;

/**
 * Event emitter interface for typed events
 */
export interface ISessionEventEmitter {
    emit(event: SessionEvent): void;
    on(listener: (event: SessionEvent) => void): () => void;
    on<T extends SessionEvent["type"]>(
        type: T,
        listener: (event: Extract<SessionEvent, { type: T }>) => void,
    ): () => void;
}
