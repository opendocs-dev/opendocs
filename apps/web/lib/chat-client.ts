// Browser-side chat calls. Kept apart from tenant-api.ts, which imports server-only code (next/headers).
import type { ChatResponse } from './tenant-api';

export async function sendChatMessage(
  slug: string,
  message: string,
  visitorId: string,
  conversationId?: string,
): Promise<ChatResponse | null> {
  try {
    const res = await fetch(`/api/v1/site/${encodeURIComponent(slug)}/chat`, {
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
          status: 'no_match',
          content: 'You have reached the question limit. Please try again later or contact our team directly.',
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
  slug: string,
  messageId: string,
  helpful: boolean,
  feedback?: string,
  visitorId?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/site/${encodeURIComponent(slug)}/chat/${encodeURIComponent(messageId)}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful, feedback, visitor_id: visitorId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
