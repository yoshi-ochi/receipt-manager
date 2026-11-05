/**
 * Receipt OCR Processor (Integrated Gemini Multimodal Client)
 */
const OCRProcessor = {
  async processImage(file) {
    const apiKey = AppStorage.getVisionKey();
    if (!apiKey) {
      alert("Google Gemini API キーが未設定です。\n右上の歯車設定からGoogle AI Studioで取得したAPIキーを入力してください。");
      throw new Error("Gemini API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);
    return await this.callGeminiAPI(base64Data, apiKey);
  },

  async callGeminiAPI(base64Image, apiKey) {
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

    const models = ["gemini-1.5-flash", "gemini-1.5-pro"];
    let lastError = null;

    for (const model of models) {
      try {
        console.log(`[OCRProcessor] Requesting Gemini Model: ${model}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

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

        const cleanJsonStr = candidateText.replace(/^```json\s*/, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
        const result = JSON.parse(cleanJsonStr);

        return {
          date: result.date || new Date().toISOString().split("T")[0],
          store: result.store || "不明店",
          totalAmount: Number(result.totalAmount) || 0,
          paymentMethod: result.paymentMethod || "現金",
          suggestedCategory: result.suggestedCategory || "消耗品費",
          suggestedGenre: "日用品・消耗品",
          items: Array.isArray(result.items) ? result.items : [],
          memo: result.memo || ""
        };

      } catch (err) {
        console.warn(`[OCRProcessor] ${model} failed:`, err);
        lastError = err;
      }
    }

    throw lastError || new Error("Gemini APIへのリクエストがすべて失敗しました。");
  },

  encodeImageToBase64(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxDimension || h > maxDimension) {
            if (w > h) {
              h = Math.round((h * maxDimension) / w);
              w = maxDimension;
            } else {
              w = Math.round((w * maxDimension) / h);
              h = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};
