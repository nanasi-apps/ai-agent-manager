import { Conversation, Message, Project } from '@agent-manager/shared';

export interface StoreData {
    conversations: Conversation[];
    projects: Project[];
}

export function normalizeMessages(messages: Message[]): Message[] {
    if (!messages || messages.length === 0) return [];

    const mergedMessages: Message[] = [];

    for (const msg of messages) {
        const content = msg.content;
        if (!content && msg.logType === 'text') continue;

        const role = msg.role;
        const type = msg.logType || 'text';

        const lastMsg = mergedMessages[mergedMessages.length - 1];
        let wasMerged = false;

        if (lastMsg) {
            const lastType = lastMsg.logType || 'text';

            if (lastMsg.role === role) {
                if (type === 'text' && lastType === 'text') {
                    lastMsg.content += content;
                    lastMsg.timestamp = msg.timestamp;
                    wasMerged = true;
                } else if (type !== 'text' && type === lastType) {
                    lastMsg.content += content;
                    lastMsg.timestamp = msg.timestamp;
                    wasMerged = true;
                }
            }
        }

        if (!wasMerged) {
            mergedMessages.push(msg);
        }
    }

    return mergedMessages;
}

export function tryMergeMessage(lastMsg: Message, newMessage: Message): boolean {
    if (!lastMsg) return false;

    const lastType = lastMsg.logType || 'text';
    const incomingType = newMessage.logType || 'text';

    if (lastMsg.role === newMessage.role) {
        if (incomingType === 'text' && lastType === 'text') {
            lastMsg.content += newMessage.content;
            lastMsg.timestamp = newMessage.timestamp;
            return true;
        } else if (incomingType !== 'text' && incomingType === lastType) {
            lastMsg.content += newMessage.content;
            lastMsg.timestamp = newMessage.timestamp;
            return true;
        }
    }
    return false;
}
