// Browser-side chat calls. Kept apart from site-api.ts, which imports server-only code (next/headers).
import type { ChatResponse } from './site-api';

export async function sendChatMessage(
  message: string,
  visitorId: string,
  conversationId?: string,
): Promise<ChatResponse | null> {
  try {
    const res = await fetch('/api/v1/site/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message,
        visitor_id: visitorId,
        conversation_id: conversationId,
      }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        return {
          conversation_id: conversationId || '',
          message_id: '',
          status: 'limit',
          content: 'You have reached the question limit for this chat today. Start a new chat or try again tomorrow.',
          sources: [],
        };
      }
      return null;
    }
    return (await res.json()) as ChatResponse;
  } catch {
    return null;
  }
}

export async function voteChatMessage(
  messageId: string,
  helpful: boolean,
  feedback?: string,
  visitorId?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/site/chat/${encodeURIComponent(messageId)}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful, feedback, visitor_id: visitorId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
