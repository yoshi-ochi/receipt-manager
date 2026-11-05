/**
 * Receipt OCR Processor (Gemini 2.5/2.0 Client)
 */
const OCRProcessor = {
  async processImage(file) {
    const apiKey = AppStorage.getVisionKey();
    if (!apiKey) {
      alert("Google Gemini API キーが未設定です。\n右上の設定から入力してください。");
      throw new Error("Gemini API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);
    return await this.callGeminiAPI(base64Data, apiKey);
  },

  async callGeminiAPI(base64Image, apiKey) {
    const promptLines = [
      '添付されたレシートまたは領収書の画像を正確に読み取り、指定のJSON形式のみを出力してください。',
      'Markdownのコードフェンスや解説文は含めず、純粋なJSONオブジェクトのみを返してください。',
      '',
      '{',
      '  "date": "YYYY-MM-DD形式の取引日付",',
      '  "store": "店舗名・会社名（ブランド名と支店名・SS名があれば連結。例: EneJet 盛岡北部SS, ユニクロ イオンモール天童店, NEXCO東日本 盛岡料金所）",',
      '  "totalAmount": 実際に支払った最終合計金額（整数）,',
      '  "paymentMethod": "「現金」「クレジットカード」「PayPay」「AEON PAY」「モバイルEneKey」の中から1つ選択",',
      '  "suggestedCategory": "青色申告決算科目（「旅費交通費」「消耗品費」「接待交際費」「福利厚生費」「通信費」等から1つ選択）",',
      '  "memo": "摘要メモ（ガソリンなら「レギュラー給油 (22.18L)」等、一般品目なら品名一覧を「、」で連結）",',
      '  "items": [',
      '    { "name": "品名（型番やバーコード等のゴミは除去）", "price": 金額（整数） }',
      '  ]',
      '}',
      '',
      '【注意事項】',
      '- totalAmount は内消費税やお釣り、小計ではなく、実際に決済・支払われた総額を正確に入れてください。',
      '- ガソリンスタンドの場合、給油量（L数）を必ずmemoや品名に含めてください。'
    ];
    const promptText = promptLines.join('\n');

    const requestBody = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json'
      }
    };

    // 404を回避するため、現行のFlashモデルを指定
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
    let lastError = null;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      try {
        console.log('[OCRProcessor] Requesting Model: ' + model);
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

        const controller = new AbortController();
        const timeoutId = setTimeout(function() { controller.abort(); }, 25000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errData = await response.json().catch(function() { return {}; });
          throw new Error(errData.error && errData.error.message ? errData.error.message : ('HTTP ' + response.status));
        }

        const data = await response.json();
        const candidateText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : null;
        if (!candidateText) {
          throw new Error('Geminiから解析テキストが得られませんでした。');
        }

        const cleanJsonStr = candidateText.replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}').trim();
        const result = JSON.parse(cleanJsonStr);

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

    throw lastError || new Error('Gemini APIへのリクエストがすべて失敗しました。');
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
          resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1]);
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
