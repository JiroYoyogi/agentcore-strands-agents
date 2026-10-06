import { z } from "zod";
import type { RequestContext } from "bedrock-agentcore/runtime";
import { createAgent } from "./agent.js";
import { classifyChatError } from "./errors.js";

// HTTPで受け取った質問を実行時に検証する。
export const requestSchema = z.object({
  message: z.string()
    .min(1)
    .max(20_000)
    .refine((value) => value.trim().length > 0, {
      message: "質問を入力してください",
    }),
}).strict();

export type ChatRequest = z.infer<typeof requestSchema>;

type Conversation = {
  agent: ReturnType<typeof createAgent>;
  busy: boolean;
  updatedAt: number;
};

// 同じセッションIDでは同じエージェントを再利用する。
// プロセスを再起動すると履歴は消える。
const conversations = new Map<string, Conversation>();

// 通常のasync関数：回答を蓄積して、最後にJSONでまとめて返す。
export async function processChat(
  request: ChatRequest,
  context: RequestContext,
) {
  let conversation = conversations.get(context.sessionId);

  if (conversation?.busy) {
    return {
      sessionId: context.sessionId,
      error: { code: "CONVERSATION_BUSY", message: "この会話は処理中です" },
    };
  }

  try {
    if (!conversation) {
      conversation = { agent: createAgent(), busy: false, updatedAt: Date.now() };
      conversations.set(context.sessionId, conversation);
    }
    conversation.busy = true;
    // 失敗時は、この呼び出しで追加された履歴を取り消す。
    const previousMessages = conversation.agent.messages.slice();

    try {
      let answer = "";

      for await (const event of conversation.agent.stream(request.message)) {
        if (event.type !== "modelStreamUpdateEvent") {
          continue;
        }

        const modelEvent = event.event;
        if (
          modelEvent.type === "modelContentBlockDeltaEvent" &&
          modelEvent.delta.type === "textDelta"
        ) {
          // 本文の断片を連結する。ここではクライアントへ送信しない。
          answer += modelEvent.delta.text;
        }
      }

      return { sessionId: context.sessionId, answer };
    } catch (error) {
      conversation.agent.messages = previousMessages;
      throw error;
    }
  } catch (error) {
    context.log.error({
      requestId: context.requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    }, "チャット処理に失敗しました");

    return {
      sessionId: context.sessionId,
      error: classifyChatError(error),
    };
    
  } finally {
    if (conversation) {
      conversation.busy = false;
      conversation.updatedAt = Date.now();
    }
  }
}
