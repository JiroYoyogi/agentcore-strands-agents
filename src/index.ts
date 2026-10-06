import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { requestSchema, processChat } from "./chat.js";
import { processChat as processChatGenerator } from "./chat_generator.js";

// "json": 通常のasync関数で回答をまとめて返す。
// "stream": 非同期ジェネレーターで回答を少しずつ返す。
const responseMode: "json" | "stream" = "json";
const handlers = {
  json: processChat,
  stream: processChatGenerator,
};

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema,
    process: handlers[responseMode],
  },
});

app.run({
  port: 8080,
  host: "127.0.0.1",
});
