function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.type === "business") {
      var sheet = ss.getSheetByName("事業用");
      if (!sheet) {
        sheet = ss.insertSheet("事業用");
        setupBusinessSheetHeaders(sheet);
      }

      var row = [
        data.date,
        data.store,
        data.memo || "",
        data.category === "売上" ? data.total : "",
        data.category === "雑収入等" ? data.total : "",
        data.category === "仕入" ? data.total : ""
      ];

      var expenseCols = [
        "租税公課", "荷造運賃", "水道光熱費", "旅費交通費", "通信費",
        "広告宣伝費", "接待交際費", "損害保険料", "修繕費", "消耗品費",
        "減価償却費", "福利厚生費", "給料賃金", "外注工賃", "利子割引料",
        "地代家賃", "貸倒金", "雑費"
      ];

      for (var i = 0; i < expenseCols.length; i++) {
        row.push(data.category === expenseCols[i] ? data.total : "");
      }

      sheet.appendRow(row);

    } else {
      var sheet = ss.getSheetByName("個人用");
      if (!sheet) {
        sheet = ss.insertSheet("個人用");
        setupPersonalSheetHeaders(sheet);
      }

      var itemsSummary = (data.items || []).map(function(item) {
        return item.name + "(¥" + item.price + ")";
      }).join(", ");

      sheet.appendRow([
        data.date,
        data.store,
        data.genre || "",
        data.total,
        itemsSummary,
        data.memo || ""
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setupBusinessSheetHeaders(sheet) {
  var headers = [
    "日付", "店名/取引先", "摘要", "売上", "雑収入等", "仕入",
    "租税公課", "荷造運賃", "水道光熱費", "旅費交通費", "通信費",
    "広告宣伝費", "接待交際費", "損害保険料", "修繕費", "消耗品費",
    "減価償却費", "福利厚生費", "給料賃金", "外注工賃", "利子割引料",
    "地代家賃", "貸倒金", "雑費"
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e2e8f0");
}

function setupPersonalSheetHeaders(sheet) {
  var headers = ["日付", "店舗名", "ジャンル", "合計金額", "購入内訳リスト", "メモ"];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#cffafe");
}
