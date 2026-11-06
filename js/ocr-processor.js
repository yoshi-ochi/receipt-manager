/**
 * Receipt OCR Processor (Multi-Model Quota Fallback)
 */
const OCRProcessor = {
  async processImage(file) {
    const apiKey = AppStorage.getVisionKey();
    if (!apiKey) {
      alert("Google Gemini API キーが未設定です。\n右上の設定から入力してください。");
      throw new Error("Gemini API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1024);
    return await this.callGeminiAPI(base64Data, apiKey.trim());
  },

  async callGeminiAPI(base64Image, apiKey) {
    const promptText = `
添付された日本のレシート・領収書画像を解析し、指定のJSONを抽出してください。

【抽出ルール】
1. date: 取引日 (YYYY-MM-DD)
2. store: 店舗・会社名（ブランド名+支店名/SS名。例: "ダイソー 仙台長町店", "セブン-イレブン", "東横イン", "EneJet 盛岡北部SS"）
3. totalAmount: 支払合計金額 (整数)
4. paymentMethod: 決済手段 ("現金", "クレジットカード", "PayPay", "AEON PAY", "モバイルEneKey" 等)
5. suggestedCategory (事業用科目): 
   - ガソリン・高速・鉄道・タクシー: "旅費交通費"
   - それ以外: "消耗品費"
6. suggestedGenre (個人用家計簿ラベル): 
   - スーパー、コンビニ、飲食店、カフェ、食品: "食品"
   - ドラッグストア、100均、日用雑貨、ホームセンター: "日用品"
   - ガソリン、電車、バス、タクシー、高速道路: "交通費"
   - ホテル、旅館、宿泊施設: "宿泊費"
   - 書籍、ゲーム、映画、レジャー、アミューズメント: "娯楽"
   - その他: "その他"
7. memo:
   - ガソリンの場合: "〇〇給油 〇〇L (〇〇円/L)"
   - 1点の場合: "1点 (商品名)"
   - 複数点の場合: "〇点 (商品名1、商品名2...)"
8. items: 購入明細リスト [{ "name": "品名", "price": 金額(整数) }]
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
        response_mime_type: "application/json",
        response_schema: {
          type: "OBJECT",
          properties: {
            date: { type: "STRING" },
            store: { type: "STRING" },
            totalAmount: { type: "INTEGER" },
            paymentMethod: { type: "STRING" },
            suggestedCategory: { type: "STRING" },
            suggestedGenre: { type: "STRING" },
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
          required: ["date", "store", "totalAmount", "paymentMethod", "suggestedCategory", "suggestedGenre", "items", "memo"]
        }
      }
    };

    // クォータ超過時に順次切り替えるモデル候補
    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ];

    let lastError = null;

    for (let i = 0; i < candidateModels.length; i++) {
      const model = candidateModels[i];
      try {
        console.log('[OCRProcessor] Trying Model: ' + model);
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(apiKey);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errData = await response.json().catch(function() { return {}; });
          const errMsg = errData.error && errData.error.message ? errData.error.message : ('HTTP ' + response.status);
          
          // 429（クォータ超過）または 404（非対応）の場合は次のモデルへフォールバック
          if (response.status === 429 || response.status === 404) {
            console.warn(`[OCRProcessor] ${model} unavailable (${response.status}): ${errMsg}`);
            lastError = new Error(errMsg);
            continue;
          }
          throw new Error(errMsg);
        }

        const data = await response.json();
        const candidateText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : null;
        if (!candidateText) {
          throw new Error('Geminiから有効な解析テキストが得られませんでした。');
        }

        const result = JSON.parse(candidateText);
        console.log(`[OCRProcessor] Success using ${model}`);

        const storeName = result.store || '';
        const isGas = /ENEOS|EneJet|出光|apollostation|コスモ|給油|SS|ガソリン/i.test(storeName);
        const finalCategory = isGas ? '旅費交通費' : (result.suggestedCategory || '消耗品費');

        return {
          date: result.date || new Date().toISOString().split('T')[0],
          store: result.store || '不明店',
          totalAmount: Number(result.totalAmount) || 0,
          paymentMethod: result.paymentMethod || 'クレジットカード',
          suggestedCategory: finalCategory,
          suggestedGenre: result.suggestedGenre || (isGas ? '交通費' : '日用品'),
          items: Array.isArray(result.items) ? result.items : [],
          memo: result.memo || ''
        };

      } catch (err) {
        lastError = err;
      }
    }

    throw new Error('すべての利用可能モデルでクォータ上限に達しました。\n約3時間後に再試行するか、別アカウントのAPIキーを設定してください。');
  },

  encodeImageToBase64(file, maxDimension) {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
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
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};

window.OCRProcessor = OCRProcessor;
