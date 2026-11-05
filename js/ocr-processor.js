const OCRProcessor = {
  async processImage(file) {
    const geminiApiKey = AppStorage.getGeminiKey();
    if (!geminiApiKey) {
      alert("Gemini API キーが未設定です。\n右上の設定アイコンからAPIキーを登録してください。");
      throw new Error("Gemini API key is not configured");
    }

    const { base64, mimeType } = await this.resizeAndEncode(file, 1200);

    // 最新の推奨モデル gemini-3.8-flash エンドポイント
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiApiKey}`;

    const prompt = 
      "添付された画像は日本のレシートまたは手書き領収書です。以下の情報を正確に読み取り、指定のJSONフォーマットのみを出力してください。\n" +
      "- date: 購入日（YYYY-MM-DD形式。不明なら本日の日付）\n" +
      "- store: 発行元・店舗名・取引先名\n" +
      "- items: 購入した品目名とその税込金額の配列 [{ \"name\": \"...\", \"price\": 数値 }]\n" +
      "- totalAmount: 合計支払金額（数値）\n" +
      "- suggestedCategory: 日本の青色申告決算書における経費勘定科目（租税公課、荷造運賃、水道光熱費、旅費交通費、通信費、広告宣伝費、接待交際費、損害保険料、修繕費、消耗品費、減価償却費、福利厚生費、給料賃金、外注工賃、利子割引料、地代家賃、貸倒金、雑費、仕入）から最も適切なものを1つ選択\n" +
      "- suggestedGenre: 家計簿用（食料品・スーパー、外食・カフェ、日用品・消耗品、趣味・教養・娯楽、交通費、衣類・美容、医療・健康、その他）から1つ選択\n" +
      "- memo: 摘要や用途に関する簡単な要約\n\n" +
      "出力は純粋なJSON文字列のみにしてください。";

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json"
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `HTTP ${response.status}: APIリクエストに失敗しました`);
    }

    const resJson = await response.json();
    let textResult = resJson.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    // Markdownコードフェンス (```json ... ```) が混在した場合の安全な除去
    textResult = textResult.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/s, "").trim();

    const data = JSON.parse(textResult);

    return {
      date: data.date || new Date().toISOString().split('T')[0],
      store: data.store || "不明店",
      items: data.items && data.items.length > 0 ? data.items : [{ name: "合算品目", price: data.totalAmount || 0 }],
      totalAmount: Number(data.totalAmount || 0),
      suggestedCategory: data.suggestedCategory || "消耗品費",
      suggestedGenre: data.suggestedGenre || "その他",
      memo: data.memo || `${data.store || ""} レシート`
    };
  },

  resizeAndEncode(file, maxDimension) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const mimeType = "image/jpeg";
          const dataUrl = canvas.toDataURL(mimeType, 0.85);
          const base64 = dataUrl.split(",")[1];
          resolve({ base64, mimeType });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};
