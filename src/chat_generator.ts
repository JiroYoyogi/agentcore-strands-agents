import type { RequestContext } from "bedrock-agentcore/runtime";
import { createAgent } from "./agent.js";
import type { ChatRequest } from "./chat.js";
import { classifyChatError } from "./errors.js";

// 入力検証の定義は一括応答版と共通にする。
export { requestSchema } from "./chat.js";

type Conversation = {
  agent: ReturnType<typeof createAgent>;
  busy: boolean;
  updatedAt: number;
};

// ストリーミング版の会話履歴。再起動すると消える。
const conversations = new Map<string, Conversation>();

// 非同期ジェネレーター：回答の断片をyieldで順次返す。
export async function* processChat(
  request: ChatRequest,
  context: RequestContext,
) {
  let conversation = conversations.get(context.sessionId);

  if (conversation?.busy) {
    yield {
      event: "error",
      data: JSON.stringify({ code: "CONVERSATION_BUSY", message: "この会話は処理中です" }),
    };
    return;
  }

  try {
    if (!conversation) {
      conversation = { agent: createAgent(), busy: false, updatedAt: Date.now() };
      conversations.set(context.sessionId, conversation);
    }
    conversation.busy = true;
    const previousMessages = conversation.agent.messages.slice();

    try {
      for await (const event of conversation.agent.stream(request.message)) {
        if (event.type !== "modelStreamUpdateEvent") {
          continue;
        }

        const modelEvent = event.event;
        if (
          modelEvent.type === "modelContentBlockDeltaEvent" &&
          modelEvent.delta.type === "textDelta"
        ) {
          // 本文の断片が届くたびにクライアントへ渡す。
          yield {
            event: "delta",
            data: JSON.stringify({ text: modelEvent.delta.text }),
          };
        }
      }

      yield {
        event: "done",
        data: JSON.stringify({ sessionId: context.sessionId }),
      };
    } catch (error) {
      conversation.agent.messages = previousMessages;
      throw error;
    }
  } catch (error) {
    context.log.error({
      requestId: context.requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "チャット処理に失敗しました");

    yield {
      event: "error",
      data: JSON.stringify(classifyChatError(error)),
    };

  } finally {
    if (conversation) {
      conversation.busy = false;
      conversation.updatedAt = Date.now();
    }
  }
}
