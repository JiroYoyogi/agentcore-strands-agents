import { useState } from "react";
import Markdown from "react-markdown";
import { streamChat } from "./chat";

type Message = { role: "user" | "assistant"; text: string };

export default function App() {
  // 画面の一覧はブラウザ、モデルに渡す会話履歴はエージェントが管理する。
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const [failedRequest, setFailedRequest] = useState<{
    question: string;
    answerIndex: number;
  } | null>(null);

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement> | null, 
    isRetry = false
  ) {
    event?.preventDefault();

    let question: string;
    let answerIndex: number;

    if (!isRetry) {
      // 通常
      if (!input.trim() || sending) return;

      question = input;
      answerIndex = messages.length + 1;
      // 空の回答を用意し、届いた文章をここへ追記する。
      setMessages([
        ...messages, // これまで
        { role: "user", text: question }, // ユーザー質問
        { role: "assistant", text: "" } // AI回答
      ]);
      setInput("");

    } else {
      // 再試行
      if (!failedRequest) return;

      question = failedRequest.question;
      answerIndex = failedRequest.answerIndex;

      setMessages((current) => {
        // current ... 今の配列
        const __messages = current.map((message, index) => {
          // エラーとなった今回の回答を空にする
          if (index === answerIndex) return { ...message, text: ""}
          return message;
        });
        return __messages;
      })
      
    }

    setError("");
    setSending(true);

    try {
      await streamChat(question, sessionId, (text) => {
        // 直前の状態を使うことで、連続して届く断片を取りこぼさない。
        setMessages((current) => current.map((message, index) =>
          index === answerIndex ? { ...message, text: message.text + text } : message,
        ));
      });

      setFailedRequest(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "通信に失敗しました。");
      setFailedRequest({ question, answerIndex });
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setSessionId(crypto.randomUUID());
    setError("");
    setFailedRequest(null);
  }

  return (
    <main>
      <h1>コード相談チャット</h1>
      <button type="button" onClick={startNewChat} disabled={sending}>新しい会話</button>

      <section aria-label="会話">
        {messages.length === 0 && <p>質問を入力してください。</p>}
        {messages.map((message, index) => (
          <article key={index}>
            <strong>{message.role === "user" ? "あなた" : "回答"}</strong>
            {message.role === "user" ? (
              <p className="message">{message.text}</p>
            ) : (
              <div className="answer">
                {/* 回答をMarkdownとして表示する。生のHTMLは表示しない。 */}
                <Markdown skipHtml>{message.text}</Markdown>
              </div>
            )}
          </article>
        ))}
      </section>
      {sending && <p role="status">回答を受信中…</p>}
      {error && <p role="alert">{error} 途中の回答は未完了です。</p>}
      {failedRequest && (
        <button
          type="button"
          onClick={() => handleSubmit(null, true)}
          disabled={sending}
        >
          再試行
        </button>
      )}

      <form onSubmit={handleSubmit}>
        <label htmlFor="message">質問・コード・エラーメッセージ</label>
        <textarea
          id="message"
          rows={6}
          maxLength={20_000}
          value={input}
          disabled={sending}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={!input.trim() || sending || failedRequest !== null}>送信</button>
      </form>
    </main>
  );
}
