import { useState } from "react";
import type { FormEvent } from "react";
import { streamChat } from "./chat";

type Message = { role: "user" | "assistant"; text: string };

export default function App() {
  // 画面の一覧はブラウザ、モデルに渡す会話履歴はエージェントが管理する。
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // フォーム送信によるページの再読み込みを防ぐ。
    if (!input.trim() || sending) return;

    const question = input;
    const answerIndex = messages.length + 1;
    // 空の回答を用意し、届いた文章をここへ追記する。
    setMessages([...messages, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setInput("");
    setError("");
    setSending(true);

    try {
      await streamChat(question, sessionId, (text) => {
        // 直前の状態を使うことで、連続して届く断片を取りこぼさない。
        setMessages((current) => current.map((message, index) =>
          index === answerIndex ? { ...message, text: message.text + text } : message,
        ));
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "通信に失敗しました。");
    } finally {
      setSending(false);
    }
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setSessionId(crypto.randomUUID());
    setError("");
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
            <p className="message">{message.text}</p>
          </article>
        ))}
      </section>
      {sending && <p role="status">回答を受信中…</p>}
      {error && <p role="alert">{error} 途中の回答は未完了です。</p>}

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
        <button type="submit" disabled={!input.trim() || sending}>送信</button>
      </form>
    </main>
  );
}
