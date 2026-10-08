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

途中から `agentcore cli` を導入

### ローカルサーバー起動

#### npm版

- app/agentで下記を実行
- `app/agent/.env`で環境変数設定

```
npm run dev
```

#### agentcore cli版

- ルートで下記を実行
- `agentcore/.env.local`で環境変数設定

```
agentcore dev --logs
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

エージェントは初期値で`stream`モードです。curlには下記オプションを追加してください。
JSON版で確認する場合はエージェントの環境変数を`RESPONSE_MODE=json`に設定します。

```
-H 'Accept: text/event-stream'
```

## デプロイ

### 実行するコマンド

- agentcore validate
- agentcore package
- agentcore deploy --dry-run
- agentcore deploy
- agentcore status

### agentcore validate

- CLI設定や形式など検証

### agentcore package

- TypeScriptをビルドしコードと依存関係をデプロイ用ZIPにまとめる
- 今回は `agentcore.json` の追加設定が必須だった（途中からCLI管理にしたためか）
- `entrypoint` の指定が効かなかったため、`app/agent/main.ts` を作成・配置する対応

```js
  "runtimes": [
    {
      "name": "CodeChatAgent",
      "build": "CodeZip",
      "entrypoint": "main.js",
      "codeLocation": "./app/agent",
      "runtimeVersion": "NODE_22",
      "networkMode": "PUBLIC",
      "protocol": "HTTP",
      "envVars": [
        {
          "name": "AWS_REGION",
          "value": "ap-northeast-1"
        },
        {
          "name": "BEDROCK_MODEL_ID",
          "value": "global.anthropic.claude-sonnet-4-6"
        }
      ]
    }
  ],
```

### agentcore deploy --dry-run

デプロイの準備・事前チェック

### agentcore deploy

デプロイ

### agentcore status

- プロジェクトのAWSリソースの状態を確認するコマンド
- Runtimeの名前・ARN・デプロイ状態・READYなどの稼働状態を表示


## Express <=> AgentCore

### セットアップ・起動

```bash
cd app/server
npm ci
cp .env.example .env
```

`.env`に`AWS_REGION`と、`agentcore status`で確認した`AGENT_RUNTIME_ARN`を設定

```bash
npm run dev
```

### 会話の扱いと動作確認

- ブラウザが新規会話で`crypto.randomUUID()`を使って`sessionId`を生成・保持
- 追加質問には同じIDを送り、新しい会話には新しいIDを使う想定
- 履歴を管理するのはAWS上のエージェント。Runtimeのセッション終了・再起動で履歴は消える

`POST /api/chat`の入力は`message`（1〜20,000文字）と`sessionId`（33〜256文字の英数字・ハイフン・アンダースコア）

```bash
curl http://127.0.0.1:3001/api/health
curl -N http://127.0.0.1:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"TypeScriptのunknownとanyの違いを短く説明してください","sessionId":"11111111-1111-4111-8111-111111111111"}'
```

同じIDで追加質問

```bash
curl -N http://127.0.0.1:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"先ほどの説明にコード例を追加してください","sessionId":"11111111-1111-4111-8111-111111111111"}'
```

- Runtimeがストリーミング版なら`delta`・`done`・`error`のSSEイベントがそのまま返る
- `done`にはエージェントが返した`sessionId`が入る。JSON版なら`answer`または`error`を含むJSONが返る

