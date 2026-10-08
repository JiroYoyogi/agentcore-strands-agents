import express from "express";
import type { ErrorRequestHandler } from "express";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const region = process.env.AWS_REGION;
const runtimeArn = process.env.AGENT_RUNTIME_ARN;
const port = Number(process.env.PORT ?? 3001);
const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000);

if (!region || !runtimeArn) throw new Error("AWS_REGIONとAGENT_RUNTIME_ARNを設定してください");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORTを確認してください");
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error("REQUEST_TIMEOUT_MSを確認してください");

// AWS SDKがローカルのAWS認証情報を取得し、リクエストに署名を付ける。
// 会話への同じ質問を自動再送しないようにする。
const client = new BedrockAgentCoreClient({ region, maxAttempts: 1 });
const app = express();

// app.use ... リクエストが来たときに登録した順序で実行

app.use((req, res, next) => {
  const origin = req.get("Origin");

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // 上記Allow-OriginがOrigin毎に違う
    // キャッシュによってオリジンAにオリジンBのAllow-Originを返すことがあると拒否される問題解消
    res.vary("Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // 204 ... 本文なしの成功応答
    res.sendStatus(204);
    return;
  }
  next();
});

// フロントがリクエスト本文をJSON形式で送る場合は、基本的にexpress.json()
// JSON形式のリクエスト本文を読み取りreq.bodyに入れる。limitは読み取る本文のサイズ上限
// ちなみに、HTMLフォームなら、express.urlencoded({ extended: false })
app.use(express.json({ limit: "128kb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body ?? {};
  if (typeof message !== "string" || !message.trim() || message.length > 20_000 ||
      typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{33,256}$/.test(sessionId)) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "messageとsessionIdを確認してください" } });
    return;
  }

  // 実行中の非同期処理を途中でキャンセルする組み込みAPI
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // まだ回答を送っている途中でユーザーがブラウザを閉じたり、通信が切れたりした場合はabort
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  // res で close イベントが発生したら、onClose を1回だけ実行
  res.once("close", onClose);

  try {
    // sessionIdはブラウザが生成・保持し、ExpressはそのままAWSへ渡す。
    // レスポンスを受け取り、本文のストリームを読み始められる状態になるまで await
    const result = await client.send(new InvokeAgentRuntimeCommand({
      agentRuntimeArn: runtimeArn,
      runtimeSessionId: sessionId,
      contentType: "application/json", // SSE形式で回答を受け取りたい
      accept: "text/event-stream",
      payload: Buffer.from(JSON.stringify({ message })),
    }), { abortSignal: controller.signal });

    // Readable... データを順次読み取れるNode.jsのストリーム
    if (!(result.response instanceof Readable)) throw new Error("Runtimeの応答を取得できませんでした");
    if (result.statusCode !== undefined && result.statusCode !== 200) {
      // 使わない応答ストリームを閉じる処理
      result.response.destroy();
      throw new Error("Runtimeの呼び出しに失敗しました");
    }
    // SSEもJSONも解析せず、そのまま中継する。pipelineが切断・流量調整を処理する。
    res.setHeader("Content-Type", result.contentType ?? "application/json");
    // no-transform ... プロキシやCDNが通信量を減らすためHTMLの空白削除や本文・画像圧縮などされる。これを禁止
    res.setHeader("Cache-Control", "no-cache, no-transform");

    // 本文を待たず、ヘッダーを先にブラウザへ送る（※無くてもOK）
    // モデルが最初の文章を生成するまでの待ち時間に、ブラウザ側がレスポンスの受信を開始できる
    res.flushHeaders();
    // await pipeline(読み取り元, 書き込み先, オプション)
    // 読み取り元から書き込み先へ、データを順次流す関数。回答それぞれを受け取るたびにresへ書き込み
    await pipeline(result.response, res, { signal: controller.signal });
  } catch (error) {
    // コードや質問、認証情報は記録しない。
    console.error(JSON.stringify({ errorName: error instanceof Error ? error.name : "UnknownError" }));
    if (!res.headersSent && !res.destroyed) {
      res.status(controller.signal.aborted ? 504 : 502).json({
        error: { code: "AGENTCORE_FAILED", message: "回答を取得できませんでした。サーバーログを確認してください" },
      });
    } else if (!res.destroyed) {
      res.destroy();
    }
  } finally {
    clearTimeout(timeout);
    // イベントリスナーをoff
    res.off("close", onClose);
  }
});

const invalidJson: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error?.type === "entity.too.large" ? 413 : 400)
    .json({ error: { code: "INVALID_INPUT", message: "JSONの形式・サイズを確認してください" } });
};
app.use(invalidJson);

app.listen(port, "127.0.0.1", () => console.log(`Local API: http://127.0.0.1:${port}`));
