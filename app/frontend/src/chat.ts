// POSTで質問を送り、SSEのdeltaイベントを受け取るたびに画面へ渡す。
export async function streamChat(
  message: string,
  sessionId: string,
  onDelta: (text: string) => void,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });

  if (!response.ok) {
    throw new Error(`回答を取得できませんでした（HTTP ${response.status}）。Expressの起動とログを確認してください。`);
  }
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
    throw new Error("SSE形式の応答ではありません。RuntimeのRESPONSE_MODEを確認してください。");
  }
  if (!response.body) throw new Error("応答の本文がありません。");

  /**
   * SSEをfetchで扱う参考記事
   * https://zenn.dev/cybozu_frontend/articles/try-server-sent-events
   * https://zenn.dev/teramotodaiki/scraps/f016ed832d6f0d
   */

  // getReader() そのストリームを読むための「読み取り役」を取得
  const reader = response.body.getReader();
  // Uint8Array => 文字列
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {

    /** 
     * ストリームが届く度のループ 
     * */
    while (!completed) {

      // 届いている文を取り出す
      const chunk = await reader.read();

      // バイト列が完成するたびにデコードされて行く
      // 不完全なバイト列はdecoderオブジェクトの内部で一時的に保持
      buffer += decoder.decode(chunk.value, { 
        // この後にもバイト列が続くフラグ
        // 「お」が"E3 81"と"8A"に分かれて届く場合がある。falseだと「お」が文字化けする
        stream: !chunk.done  
      });

      /**
       * 完全なSSEイベント
       * event: delta
       * data: "{\"text\":\"こんにちは\"}"
       * ［空行］
       */

      /**
       * bufferは不完全である可能性
       * 
       * 1. eventの行すら完成していない
       * buffer = "eve";
       * 
       * 2. dataの行が途中
       * buffer = 'event: delta\ndata: "{\\"text';
       * 
       * 3. 完成したイベントが入っている
       * buffer = 'event: delta\ndata: "{\\"text\\":\\"こんにちは\\"}"\n\n';
       */

      const events = buffer.split(/\r?\n\r?\n/);

      // 不完全なSSEイベントは次のbufferの先頭にする
      buffer = events.pop()!;

      // 完全なSSEイベントを処理
      for (const sseEvent of events) {

        let event = "";
        let data = "";

        const lines = sseEvent.split("\n")
          .map((line) => line.replace(/\r$/, ""));

        for (const line of lines) {
          if (line.startsWith("event:")) {
            event = line.replace(/^event:/, "").trim();
          }

          if (line.startsWith("data:")) {
            data += line.replace(/^data:/, "") + "\n";
          }
        }

        if (data) {
          let payload = JSON.parse(data);
          if (typeof payload === "string") {
            payload = JSON.parse(payload);
          }

          if (event === "delta") onDelta(payload.text);
          if (event === "error") throw new Error(payload.message);
        }

        if (event === "done") {
          completed = true;
          break;
        }

      } // for sseEvent
          
      if (chunk.done) break;
      
    } // while

    if (!completed) throw new Error("回答の受信が途中で終了しました。");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
