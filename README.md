# Receipt Manager (レシート管理・青色申告決算仕訳＆家計簿)

青色申告決算書（一般用）準拠の事業用記帳と、店名・内訳・ジャンル別の個人用家計簿を両立させたモバイル対応Webアプリ。

## ディレクトリ構成
- `index.html`: UIレイアウト・モーダル骨格
- `css/`: スタイルシート（共通スタイル、Particle Sphere、Skeleton Shimmer）
- `js/`: ロジック（勘定科目設定、球体描画、OCR処理、データ永続化/GAS同期、画面制御）
- `gas/`: Googleスプレッドシート連携用 Apps Script
