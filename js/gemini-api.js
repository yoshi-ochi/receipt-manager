/**
 * Gemini API Client for Multimodal Receipt Parsing
 */
const GeminiClient = {
  async analyzeReceipt(base64Image, apiKey) {
    if (!apiKey) {
      throw new Error("APIキーが設定されていません。右上の設定から入力してください。");
    }

    const promptText = `
あなたは優秀な日本の経理・会計アシスタントです。
添付されたレシートまたは領収書の画像を正確に読み取り、以下のJSONフォーマットのみを出力してください。Markdownのコードブロック(```json ... ```)を含めず、純粋なJSON文字列として返してください。

{
  "date": "YYYY-MM-DD形式の取引日付",
  "store": "店舗名・会社名（ブランド名と支店名・SS名があれば連結。例: EneJet 盛岡北部SS, ユニクロ イオンモール天童店）",
  "totalAmount": 実際に支払った最終合計金額（整数）,
  "paymentMethod": "「現金」「クレジットカード」「PayPay」「AEON PAY」「モバイルEneKey」の中から1つ選択",
  "suggestedCategory": "青色申告決算科目（「旅費交通費」「消耗品費」「接待交際費」「福利厚生費」「通信費」等から1つ選択）",
  "memo": "摘要メモ（ガソリンなら「レギュラー給油 (22.18L)」等、一般品目なら品名一覧を「、」で連結）",
  "items": [
    { "name": "品名（型番やバーコード等のゴミは除去）", "price": 金額（整数） }
  ]
}

【注意事項】
- totalAmount は「内消費税」「お釣り」「小計」「ポイント」ではなく、実際に決済・支払われた総額を正確に入れてください。
- ガソリンスタンドのレシートの場合、給油量（L数）を必ずmemoや品名に含めてください。
`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json"
      }
    };

    // 最も安定しているモデルを優先して試行
    const models = ["gemini-1.5-flash", "gemini-1.5-pro"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[GeminiClient] Requesting model: ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000); // 25秒タイムアウト

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!candidateText) {
          throw new Error("Geminiから解析テキストが得られませんでした。");
        }

        // Markdownブロックのバッククォートが含まれている場合のクリーンアップ
        const cleanJsonStr = candidateText.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(cleanJsonStr);
        console.log(`[GeminiClient] Success with ${model}:`, parsed);
        return parsed;

      } catch (err) {
        console.warn(`[GeminiClient] ${model} failed:`, err);
        lastError = err;
      }
    }

    throw lastError || new Error("Gemini APIへのリクエストがすべて失敗しました。");
  }
};
window.GeminiClient = GeminiClient;
