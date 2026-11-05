/**
 * Receipt OCR & Data Extraction Pipeline (Tesseract.js Client-Side Library)
 * 外部API・AIキー不要：ブラウザ内Wasmで完結するOCRエンジン
 */
const OCRProcessor = {
  worker: null,

  async initWorker() {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker("jpn+eng");
    }
    return this.worker;
  },

  async processImage(file) {
    const loaderText = document.getElementById("loader-text");
    if (loaderText) loaderText.textContent = "OCRエンジンを初期化中...";

    const worker = await this.initWorker();

    // 1. 画像の前処理（コントラスト調整・二値化で認識率を大幅向上）
    if (loaderText) loaderText.textContent = "画像の前処理を実行中...";
    const processedCanvas = await this.preprocessImage(file);

    // 2. OCR実行（進捗表示付き）
    if (loaderText) loaderText.textContent = "レシート文字を認識中...";
    const { data: { text } } = await worker.recognize(processedCanvas);

    console.log("=== Tesseract Raw OCR Output ===");
    console.log(text);

    // 3. ルールベースによる品目・金額・店名・科目の解析
    return this.parseReceiptText(text);
  },

  // 画像の二値化＆グレースケール変換（文字の輪郭を強調）
  preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          // コントラスト調整
          const imgData = ctx.getImageData(0, 0, w, h);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            // ハイコントラスト二値化
            const val = gray > 140 ? 255 : (gray < 80 ? 0 : gray);
            d[i] = val;
            d[i + 1] = val;
            d[i + 2] = val;
          }
          ctx.putImageData(imgData, 0, 0);
          resolve(canvas);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // OCRテキストから正規表現とパターンマッチングで構造化データを抽出
  parseReceiptText(rawText) {
    const lines = rawText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let items = [];
    let totalAmount = 0;

    // 1. 日付抽出 (YYYY年MM月DD日 または YYYY/MM/DD, YYYY-MM-DD)
    const dateRegex = /(20\d{2})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/;
    for (const line of lines) {
      const match = line.match(dateRegex);
      if (match) {
        const y = match[1];
        const m = match[2].padStart(2, "0");
        const d = match[3].padStart(2, "0");
        date = `${y}-${m}-${d}`;
        break;
      }
    }

    // 2. 店舗名（上部3行の中から記号等を除去して抽出）
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      const line = lines[i];
      if (!line.match(/領収|レシート|No|TEL|電話|登録|20\d{2}/i) && line.length >= 2) {
        store = line.replace(/[*#=＝\-]/g, "").trim();
        break;
      }
    }
    if (!store) store = "レシート発行元";

    // 3. 合計金額の抽出
    // 「合計」「小計」「支払」「税込」「お買上」等の行から数値を抽出
    const totalKeywords = /合計|総計|小計|お買上|支払|請求|合\s*計/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (totalKeywords.test(line)) {
        const numMatch = line.replace(/,/g, "").match(/(\d{2,8})\s*(円|¥)?/);
        if (numMatch) {
          totalAmount = parseInt(numMatch[1], 10);
          break;
        }
      }
    }

    // 4. 明細・品目行の抽出
    // 「品名 + 価格」の行をパース
    const priceRegex = /([¥￥])?\s*([1-9]\d{1,6})\s*(円)?$/;
    for (const line of lines) {
      // 合計や店舗ヘッダー、税額表示の除外
      if (line.match(/合計|小計|お預|釣|税|消費税|対象|TEL|割引|ポイント|クレジット|現金|登録番号/)) continue;

      const cleanLine = line.replace(/[,，]/g, "");
      const match = cleanLine.match(priceRegex);
      if (match) {
        const price = parseInt(match[2], 10);
        // 価格部分を除いた前半を品名とする
        let itemName = cleanLine.substring(0, match.index).replace(/[*#※\-\(\)（）]/g, "").trim();
        if (itemName.length >= 2 && price < 1000000) {
          items.push({ name: itemName, price: price });
        }
      }
    }

    // 合計が拾えなかった場合、明細の合計で補完
    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + item.price, 0);
    }

    // 品目が1件も取れなかった場合、合計行を1品目としてセット
    if (items.length === 0) {
      items.push({ name: `${store}での利用分`, price: totalAmount });
    }

    // 5. 青色申告科目＆家計簿ジャンルの自動判定（キーワード辞書）
    const fullText = rawText.toLowerCase();
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (/ガソリン|給油|駐車|高速|乗車|タクシー|suica|pasmo|jr|地下鉄|電車|バス/.test(fullText)) {
      suggestedCategory = "旅費交通費";
      suggestedGenre = "交通費";
    } else if (/カフェ|珈琲|コーヒー|喫茶|居酒屋|飲食|ランチ|ディナー|バー|レストラン/.test(fullText)) {
      suggestedCategory = "接待交際費";
      suggestedGenre = "外食・カフェ";
    } else if (/スーパー|食品|生鮮|牛乳|パン|青果|精肉|弁当|米/.test(fullText)) {
      suggestedCategory = "福利厚生費";
      suggestedGenre = "食料品・スーパー";
    } else if (/本|書籍|図書|雑誌|新聞|文具|ノート|ペン|用紙/.test(fullText)) {
      suggestedCategory = "消耗品費";
      suggestedGenre = "趣味・教養・娯楽";
    } else if (/切手|ハガキ|郵便|配送|送料|ヤマト|佐川/.test(fullText)) {
      suggestedCategory = "通信費";
      suggestedGenre = "その他";
    } else if (/修理|交換|部品|メンテナンス/.test(fullText)) {
      suggestedCategory = "修繕費";
      suggestedGenre = "その他";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      memo: `${store} (自動OCR)`
    };
  }
};
