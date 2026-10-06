type ChatError = {
  code: string;
  message: string;
};

export function classifyChatError(error: unknown): ChatError {
  const name = error instanceof Error ? error.name : "";

  switch (name) {
    case "CredentialsProviderError":
      return {
        code: "AWS_CREDENTIALS_MISSING",
        message: "AWS認証情報を取得できません。AWS_PROFILEなどの設定を確認してください。",
      };

    case "ExpiredTokenException":
    case "ExpiredToken":
      return {
        code: "AWS_CREDENTIALS_EXPIRED",
        message: "AWS認証情報の期限が切れています。再ログインしてください。",
      };

    case "UnrecognizedClientException":
    case "InvalidSignatureException":
      return {
        code: "AWS_AUTH_FAILED",
        message: "AWS認証に失敗しました。認証情報とリージョン設定を確認してください。",
      };

    case "AccessDeniedException":
      return {
        code: "MODEL_ACCESS_DENIED",
        message: "モデルへのアクセスが拒否されました。IAM権限とモデルの利用条件を確認してください。",
      };

    case "ResourceNotFoundException":
      return {
        code: "MODEL_NOT_FOUND",
        message: "指定したリソースが見つかりません。モデルIDとリージョンを確認してください。",
      };

    case "ValidationException":
      return {
        code: "MODEL_REQUEST_INVALID",
        message: "モデルへのリクエストが無効です。モデルID・入力サイズ・モデルの対応機能を確認してください。",
      };

    case "ThrottlingException":
      return {
        code: "MODEL_RATE_LIMITED",
        message: "モデルの利用制限に達しました。少し時間を置いて再試行してください。",
      };

    case "ServiceUnavailableException":
    case "InternalServerException":
      return {
        code: "MODEL_UNAVAILABLE",
        message: "モデル側で一時的な障害が発生しました。時間を置いて再試行してください。",
      };

    default:
      return {
        code: "CHAT_FAILED",
        message: "回答を取得できませんでした。サーバーログを確認してください。",
      };
  }
}