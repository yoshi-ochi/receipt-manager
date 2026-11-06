/**
 * Receipt OCR Processor (Gemini 3.8 / 3.5 Flash Client)
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
    const promptText = "日本のレシート画像から、取引日(date: YYYY-MM-DD)、店名(store)、最終合計支払額(totalAmount: 整数)、決済手段(paymentMethod: 現金/クレジットカード/PayPay/AEON PAY/モバイルEneKey)、勘定科目(suggestedCategory)、メモ(memo)、品目リスト(items: [{name, price}])を抽出してください。ガソリン給油ならL数を品名かmemoに記載。";

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

    // API指示に従い 3.8-flash を本線、3.5-flash をフォールバックに指定
    const targetModels = ['gemini-3.8-flash', 'gemini-3.5-flash'];
    let lastError = null;

    for (let i = 0; i < targetModels.length; i++) {
      const model = targetModels[i];
      try {
        console.log('[OCRProcessor] Requesting Model: ' + model);
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
          throw new Error(errData.error && errData.error.message ? errData.error.message : ('HTTP ' + response.status));
        }

        const data = await response.json();
        const candidateText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : null;
        if (!candidateText) {
          throw new Error('Geminiから有効な解析テキストが得られませんでした。');
        }

        const result = JSON.parse(candidateText);
        console.log('[OCRProcessor] Success with ' + model + ':', result);

        return {
          date: result.date || new Date().toISOString().split('T')[0],
          store: result.store || '不明店',
          totalAmount: Number(result.totalAmount) || 0,
          paymentMethod: result.paymentMethod || '現金',
          suggestedCategory: result.suggestedCategory || '消耗品費',
          suggestedGenre: '日用品・消耗品',
          items: Array.isArray(result.items) ? result.items : [],
          memo: result.memo || ''
        };

      } catch (err) {
        console.warn('[OCRProcessor] ' + model + ' failed:', err);
        lastError = err;
      }
    }

    throw lastError || new Error('Gemini APIへのリクエストに失敗しました。');
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
          resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
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
