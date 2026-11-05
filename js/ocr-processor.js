/**
 * Receipt OCR Processor (Google Cloud Vision API + 日本レシート専用スマートパーサー)
 */
const OCRProcessor = {
  async processImage(file) {
    const visionKey = AppStorage.getVisionKey();
    if (!visionKey) {
      alert("Google Cloud Vision API キーが未設定です。\n右上の設定アイコンからAPIキーを登録してください。");
      throw new Error("Vision API key is not configured");
    }

    const base64Data = await this.encodeImageToBase64(file, 1600);
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`;

    const requestBody = {
      requests: [
        {
          image: { content: base64Data },
          features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
          imageContext: { languageHints: ["ja", "en"] }
        }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}: Vision APIエラー`);
    }

    const result = await response.json();
    const annotation = result.responses?.[0]?.fullTextAnnotation;
    if (!annotation || !annotation.text) {
      throw new Error("文字を検出できませんでした。もう少し明るい場所で正面から撮影してください。");
    }

    return this.parseSmartReceipt(annotation.text);
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
              w = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * レシート構造化パースエンジン
   */
  parseSmartReceipt(fullText) {
    const rawLines = fullText.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    let store = "";
    let date = new Date().toISOString().split("T")[0];
    let totalAmount = 0;
    let items = [];

    // 1. 日付の検出 (YYYY年MM月DD日 または YYYY/MM/DD, YYYY-MM-DD, 令和X年)
    const dateMatch = fullText.match(/(20\d{2})[年\/\-\.\s](\d{1,2})[月\/\-\.\s](\d{1,2})/);
    if (dateMatch) {
      const y = dateMatch[1];
      const m = dateMatch[2].padStart(2, "0");
      const d = dateMatch[3].padStart(2, "0");
      date = `${y}-${m}-${d}`;
    }

    // 2. 店舗名の抽出（先頭5行の中で記号や管理文字列以外の最有力行）
    const headerExcludeRegex = /領収|レシート|No|TEL|電話|登録|20\d{2}|株式会社|チェーン|お買上|税|伝票/i;
    for (let i = 0; i < Math.min(6, rawLines.length); i++) {
      const line = rawLines[i].replace(/[!！\*#=＝\-_]/g, "").trim();
      if (line.length >= 2 && !headerExcludeRegex.test(line)) {
        store = rawLines[i].trim();
        break;
      }
    }
    if (!store && rawLines.length > 0) store = rawLines[0];

    // 3. 管理情報・メタ情報の除外正規表現フィルター
    const metaFilter = /(レシート\s*No|レジ\s*No|伝票|端末|取引|係員|担当|責任者|TEL|電話|FAX|登録番号|事業者|登録\s*No|T\d{7,13}|P\d{6,}|\d{1,2}:\d{2}|コード|カード|クレジット|現金|お預|釣|買上計|小計|合計|内税|外税|対象額|値引|割引|ポイント)/i;

    // 4. 合計金額の特定（後方から「合計」「お買上」等のキーワードを探す）
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line.match(/(合\s*計|総\s*計|お買上額|ご請求|お支払い|現\s*計)/i)) {
        // 同じ行または直後の行から金額を抽出
        let searchScope = line;
        if (i + 1 < rawLines.length && !rawLines[i + 1].match(/合|計|税|預/)) {
          searchScope += " " + rawLines[i + 1];
        }
        const numMatch = searchScope.replace(/[,，\s]/g, "").match(/([¥￥\\])?(\d{2,8})(円)?/);
        if (numMatch) {
          totalAmount = parseInt(numMatch[2], 10);
        }
      }
    }

    // 5. 明細行の抽出（中段エリアから品名と金額を抽出）
    let insideItemZone = false;
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];

      // 合計・小計ゾーンに突入したら明細終了
      if (line.match(/^(合\s*計|総\s*計|小\s*計|お買上額|ご請求|お支払|現\s*計|クレジット)/i)) {
        break;
      }

      // ヘッダー除外
      if (metaFilter.test(line)) {
        continue;
      }

      // 金額パターン（行末または末尾付近にある数値: 例 "100", "¥110", "300 外", "120※"）
      const priceMatch = line.replace(/[,，]/g, "").match(/([¥￥\\])?\s*([1-9]\d{1,5})\s*(円|※|[*]|外|内|D|非)?$/);

      if (priceMatch) {
        const price = parseInt(priceMatch[2], 10);
        let itemName = line.replace(/[,，]/g, "").substring(0, priceMatch.index).trim();

        // 不要な記号や先頭・末尾のノイズをクリーンアップ
        itemName = itemName.replace(/^[\s\d\-—―\*※・/／]+/, "").replace(/[\-—―\*※/／\s]+$/, "").trim();

        // 品名として妥当（2文字以上かつメタ情報を含まない、価格が常識的な範囲）
        if (itemName.length >= 2 && !metaFilter.test(itemName) && price >= 10 && price < 1000000) {
          items.push({ name: itemName, price: price });
        }
      }
    }

    // 明細合計から合計額を算出（合計行が取れなかった場合のフォールバック）
    if (totalAmount === 0 && items.length > 0) {
      totalAmount = items.reduce((sum, item) => sum + item.price, 0);
    }

    // 明細が1つも取れなかった場合のフォールバック
    if (items.length === 0) {
      items.push({ name: `${store} お買上分`, price: totalAmount });
    }

    // 6. 勘定科目・家計簿ジャンル判定
    const lower = fullText.toLowerCase();
    let suggestedCategory = "消耗品費";
    let suggestedGenre = "日用品・消耗品";

    if (/ダイソー|セリア|キャンドゥ|無印|ロフト|文具|事務|ホームセンター|コーナン|カインズ/.test(store + lower)) {
      suggestedCategory = "消耗品費";
      suggestedGenre = "日用品・消耗品";
    } else if (/スーパー|ライフ|イオン|西友|業務スーパー|精肉|青果|生鮮|食品|弁当/.test(store + lower)) {
      suggestedCategory = "福利厚生費";
      suggestedGenre = "食料品・スーパー";
    } else if (/カフェ|喫茶|スタバ|ドトール|居酒屋|レストラン|食堂|ランチ|マクドナルド/.test(store + lower)) {
      suggestedCategory = "接待交際費";
      suggestedGenre = "外食・カフェ";
    } else if (/ガソリン|エネオス|出光|駐車|タイムズ|jr|高速|タクシー|交通/.test(store + lower)) {
      suggestedCategory = "旅費交通費";
      suggestedGenre = "交通費";
    }

    return {
      date: date,
      store: store,
      items: items,
      totalAmount: totalAmount,
      suggestedCategory: suggestedCategory,
      suggestedGenre: suggestedGenre,
      memo: `${store}（${items.map(i => i.name).slice(0, 2).join('、')}等）`
    };
  }
};
