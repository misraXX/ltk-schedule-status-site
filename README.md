# LTK Schedule Status Site

GitHub Pagesで公開する表示専用サイトです。

## 役割

- GAS Web APIからLTKDBの予定、結果、LIVE NOWを読む
- カレンダー、リーグ表、ランキング、個人スタッツ、チャンピオン集計を表示する
- スプレッドシートへは書き込まない

## 公開対象

- `index.html`
- `app.js`
- `sheet-loader.js`
- `styles.css`
- `image/`

## ローカル確認

```powershell
node --check app.js
node --input-type=module -e "import('./sheet-loader.js')"
```

## 開発運用ドキュメント

- [AGENTS.md](AGENTS.md)
- [docs/development-rules.md](docs/development-rules.md)
- [docs/design.md](docs/design.md)
- [docs/analytics.md](docs/analytics.md)

公開時は `index.html` の `styles.css?v=...` / `app.js?v=...` と、`app.js` 先頭の `sheet-loader.js?v=...` を同じ値に揃えます。
