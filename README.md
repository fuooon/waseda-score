# ⚾ 早稲田式スコアブック

少年野球向けの早稲田式スコア記録Webアプリです。  
試合のスコアをスマホから簡単に記録し、画像としてLINEグループなどに共有できます。

## 主な機能

- **試合設定** — 日付・チーム名・球場・イニング数（5〜9回）・DH制の設定
- **メンバー管理** — 選手の名前・背番号・打ち方・ポジションを登録・管理
- **スタメン登録** — 先攻・後攻それぞれの打順とポジションを設定
- **スコア記録** — 早稲田式の記号で打席結果をタップ入力
- **記号ガイド** — 守備番号・塁の表記・打撃結果・アウトの書き方をアプリ内で確認
- **画像エクスポート** — フルスコアシート or スコアボードを画像化してダウンロード・共有

## 技術スタック

| 項目 | 技術 |
|------|------|
| ビルドツール | [Vite](https://vitejs.dev/) |
| 画像エクスポート | [html2canvas](https://html2canvas.hertzen.com/) |
| フォント | Noto Sans JP / M PLUS 1 (Google Fonts) |
| フレームワーク | なし（Vanilla JS） |

## セットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発サーバーの起動
npm run dev
```

開発サーバーが起動したら、表示されるURL（通常 `http://localhost:5173`）をブラウザで開いてください。

## ビルド

```bash
# 本番ビルド
npm run build

# ビルド結果のプレビュー
npm run preview
```

## プロジェクト構成

```
waseda-score/
├── index.html          # メインHTML
├── package.json
├── vite.config.js
└── src/
    ├── style.css       # スタイルシート
    ├── main.js         # エントリーポイント・ページ遷移制御
    ├── data.js         # データ管理（localStorage）
    ├── game-setup.js   # 試合設定画面
    ├── lineup.js       # スタメン登録画面
    ├── scoresheet.js   # スコアシート描画
    ├── score-input.js  # 打席結果入力モーダル
    ├── scoreboard.js   # スコアボード表示
    ├── export.js       # 画像エクスポート
    └── team-members.js # メンバー管理画面
```

## ライセンス

MIT
