/**
 * Receipt OCR Processor (Gemini 3.8 Flash Client)
 * - ガソリン系: 旅費交通費 / 〇L(〇円/L)
 * - その他: 消耗品費 / 〇点(内訳)
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
添付された日本のレシート・領収書画像を解析し、正確なJSONを抽出してください。

【抽出およびフォーマットルール】
1. date: 取引日 (YYYY-MM-DD)
2. store: 店舗・企業名（ブランド名+支店・SS名。例: "EneJet 盛岡北部SS", "ユニクロ 盛岡インター店"）
3. totalAmount: 実際に決済・支払われた最終合計金額 (整数)
4. paymentMethod: 決済手段 ("現金", "クレジットカード", "PayPay", "AEON PAY", "モバイルEneKey" のいずれか)
5. suggestedCategory:
   - ガソリンスタンド、給油、ENEOS、出光、コスモ、高速料金、JR・電車、交通系の場合: 必ず "旅費交通費"
   - それ以外の一般的な物品購入の場合: 原則 "消耗品費"
6. items: 購入明細リスト [{ "name": "品名", "price": 金額(整数) }]
7. memo (摘要フォーマット):
   - 【ガソリン・軽油等の給油の場合】: 
     給油量(L)と単価(円/L)を読み取り、「〇〇給油 〇〇L (〇〇円/L)」の形式にする。
     例: "レギュラー給油 22.18L (153円/L)"、"ハイオク給油 35.00L (168円/L)"
   - 【商品が1点のみの場合】: 
     "1点 (商品名)" の形式にする。
     例: "1点 (エアリズムシームレスボクサー)"
   - 【商品が複数点（2点以上）ある場合】: 
     "〇点 (商品名1、商品名2、商品名3...)" の形式にする。
     例: "3点 (ノート、消しゴム、替芯)"
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

        // クライアント側でもガソリン判定のフォールバックを二重補強
        const storeName = result.store || '';
        const isGasStation = /ENEOS|EneJet|出光|apollostation|コスモ|シェル|キグナス|給油|SS|ガソリン/i.test(storeName);
        
        const finalCategory = isGasStation ? '旅費交通費' : (result.suggestedCategory || '消耗品費');

        // 摘要がプロンプトで漏れた場合のフォーマット整形
        let finalMemo = result.memo || '';
        const items = Array.isArray(result.items) ? result.items : [];
        if (!finalMemo || (!isGasStation && !finalMemo.includes('点'))) {
          if (items.length === 1) {
            finalMemo = `1点 (${items[0].name})`;
          } else if (items.length > 1) {
            const names = items.map(it => it.name).join('、');
            finalMemo = `${items.length}点 (${names})`;
          }
        }

        return {
          date: result.date || new Date().toISOString().split('T')[0],
          store: result.store || '不明店',
          totalAmount: Number(result.totalAmount) || 0,
          paymentMethod: result.paymentMethod || '現金',
          suggestedCategory: finalCategory,
          suggestedGenre: isGasStation ? '交通費' : '日用品・消耗品',
          items: items,
          memo: finalMemo
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
