/**
 * Receipt Intelligence Processor using Gemini 3.8 Flash
 * マルチモーダルLLMが文脈から直接正確なJSONを抽出
 */
const OCRProcessor = {
  async processImage(file) {
    const apiKey = AppStorage.getVisionKey(); // ストレージ内のGemini API Key
    if (!apiKey) {
      alert("Gemini API キーが未設定です。\n右上の歯車設定からGoogle AI Studioで取得したAPIキーを入力してください。");
      throw new Error("Gemini API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);
    // 最新モデル gemini-3.8-flash に更新
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

    const promptText = `
添付されたレシート画像を正確に解析し、日本の確定申告・家計簿に必要な情報を抽出してください。

【抽出ルール】
1. date: 取引年月日（YYYY-MM-DD形式）。
2. store: 店舗・会社名（ブランド名と支店名・SS名があれば連結。例: "EneJet 盛岡北部SS", "ユニクロ イオンモール天童店", "スーパービバホーム 仙台中山店", "東日本旅客鉄道株式会社", "NEXCO東日本 盛岡料金所"）。
3. totalAmount: 実際に支払った最終合計金額（整数）。内消費税、小計、対象額、お釣り、ポイントではなく、最終請求・支払総額を確実に抽出。
4. paymentMethod: 決済手段。「現金」「クレジットカード」「PayPay」「AEON PAY」「モバイルEneKey」の5つの中から最も適切なものを1つ選択（レシート内の印字から判定。コスモザカードや一括払いは「クレジットカード」、他QRは「PayPay」）。
5. suggestedCategory: 勘定科目。「旅費交通費」「消耗品費」「接待交際費」「福利厚生費」「通信費」等から最適と思われるものを選択（給油・高速・JRは「旅費交通費」、郵便切手は「通信費」）。
6. items: 購入明細リスト。各要素は { "name": 品名, "price": 金額 }。
   - ガソリンスタンドの場合: 品名は「レギュラー給油 (22.18L)」のように給油量L数を含め、金額は給油総額とする。単価(@153等)は品名にしない。
   - 一般店舗の場合: 商品コード(<0838>等)や管理番号は除外したきれいな品名にする。
7. memo: 摘要メモ。ガソリンなら給油量、一般品なら主要な商品名を「、」で連結した文字列。
`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING" },
            store: { type: "STRING" },
            totalAmount: { type: "INTEGER" },
            paymentMethod: { type: "STRING" },
            suggestedCategory: { type: "STRING" },
            memo: { type: "STRING" },
            items: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  price: { type: "INTEGER" }
                },
                required: ["name", "price"]
              }
            }
          },
          required: ["date", "store", "totalAmount", "paymentMethod", "suggestedCategory", "items", "memo"]
        }
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}: Gemini APIエラー`);
    }

    const result = await response.json();
    const candidate = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error("レシートの解析結果を取得できませんでした。");
    }

    const parsedData = JSON.parse(candidate);
    console.log("=== Gemini Structured Output ===", parsedData);

    return {
      date: parsedData.date || new Date().toISOString().split("T")[0],
      store: parsedData.store || "不明店",
      totalAmount: parsedData.totalAmount || 0,
      paymentMethod: parsedData.paymentMethod || "現金",
      suggestedCategory: parsedData.suggestedCategory || "消耗品費",
      suggestedGenre: "日用品・消耗品",
      items: parsedData.items || [],
      memo: parsedData.memo || ""
    };
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
          resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};
