## プロジェクト準備

### インストール

```
# アプリの実行に必要なもの
npm install bedrock-agentcore @strands-agents/sdk zod

# 開発に必要なもの
npm install -D typescript @types/node@22 tsx
```

### tsconfig.json作成

```
npx tsc --init
```

↓ 書き換え

```js
{
  "compilerOptions": {
    // TypeScriptをES2022へ変換
    "target": "ES2022", 
    // import？require？ NodeNext => package.jsonの"type"に連携
    // 取りうる値：CommonJS, ES2022, ESNext, AMD, UMD ...
    "module": "NodeNext", 
    // TypeScriptが読み込み先とその型情報をどう探すか
    // tsファイルでも .js で読み込む import { hello } from "./hello.js";
    "moduleResolution": "NodeNext",
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## zod

`BedrockAgentCoreApp` の `requestSchema` は `zod` のスキーマを渡す前提の設定

- chat.ts

```ts
export const requestSchema = z.object({
  message: z.string()
    .min(1)
    .max(20_000)
    .refine((value) => value.trim().length > 0, {
      message: "質問を入力してください",
    }),
}).strict();
```

- index.ts

`requestSchema` は `zod` を使って作られている前提である。SDK内で検証されている。

`zod` を使うことで、不正な入力がモデル呼び出しまで進むのを防いでいる。

```ts
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema, // ← SDKに検証を依頼する
    process: processChat,
  },
});
```

## ジェネレーター関数

```js
function* answerParts() {
  yield "こんにちは";
  yield "。";
  yield "質問に回答します";
}

const parts = answerParts();

console.log(parts.next());
// { value: "こんにちは", done: false }

console.log(parts.next());
// { value: "。", done: false }
```

## エージェントが返すイベント

### 例

```js
{
  type: "modelStreamUpdateEvent",       // エージェントのイベント種別
  event: {
    type: "modelContentBlockDeltaEvent", // モデルのイベント種別
    delta: {
      type: "textDelta",                // 断片の種類
      text: "こんにちは"                // 今回届いた本文
    }
  }
}
```

### 基本の扱い方

`event` に何が入ってるかは「回答をまとめて返すパターン」をベースに `console.log` する

#### 回答をまとめて返すパターン：

```js
for await (const event of conversation.agent.stream(request.message)) {
  if (event.type !== "modelStreamUpdateEvent") {
    continue;
  }

  const modelEvent = event.event;

  if (
    modelEvent.type === "modelContentBlockDeltaEvent" &&
    modelEvent.delta.type === "textDelta"
  ) {
    answer += modelEvent.delta.text;
  }
}
```

#### 回答をストリーミングで都度返すパターン：

```js
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
```

## ローカルサーバーで実行

### ローカルサーバー起動

```
npm run dev
```

### リクエスト

```
curl -i http://127.0.0.1:8080/invocations \
  -H 'Content-Type: application/json' \
  -H 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"message":"TypeScriptのunknownとanyの違いを教えてください"}'
```

同じセッションIDで追加質問

```
curl -i http://127.0.0.1:8080/invocations \
  -H 'Content-Type: application/json' \
  -H 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{"message":"先ほどの説明に短いコード例を追加してください"}'
```

`"stream"`モードで実行したい場合は下記オプションを追加

```
-H 'Accept: text/event-stream'
```

