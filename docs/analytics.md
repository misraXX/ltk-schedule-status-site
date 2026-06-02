# GA4計測設計

この文書は、LTK Schedule & Status サイトのGA4計測に関する最低限の設計書である。

## 既存構成

- GA4タグは既に `index.html` に存在する。
- 既存イベント送信は `app.js` に存在する。
- `app.js` では `gtag` を使ってイベント送信している。
- `gtag` 未定義時に実行時エラーにしない方針を維持する。

## 既存で計測している可能性があるイベント

- `page_view`
- `select_content`
- `filter_change`
- `click`
- `scroll`

実際のイベント名は `app.js` の実装を確認してから変更する。

## URL付きタブ化時の方針

URL付きタブ化時には、タブ切り替えでGA4の仮想 `page_view` を送る予定である。

仮想 `page_view` では、少なくとも次を送る想定とする。

- `page_path`
- `page_title`

例:

- `/#/schedule` -> `page_path: /schedule`, `page_title: 予定`
- `/#/clips` -> `page_path: /clips`, `page_title: 切り抜き動画`

## 切り抜き動画ページの計測方針

切り抜き動画ページは現時点では本番公開対象外である。

YouTubeまとめとTwitchクリップまとめの計測仕様は、ローカル確認用または将来公開時の予約仕様として保持する。本番では `/#/clips` 配下が表示されないため、通常はこれらの `page_view` やクリックイベントは発火しない。

### 仮想page_view

切り抜き動画ページを公開する場合は、次の仮想 `page_view` を送る想定とする。

1. `/#/clips`

- `page_path: /clips`
- `page_title: 切り抜き動画`

2. `/#/clips/youtube`

- `page_path: /clips/youtube`
- `page_title: YouTubeまとめ`

3. `/#/clips/twitch`

- `page_path: /clips/twitch`
- `page_title: Twitchクリップまとめ`

### YouTube / Twitchサブタブ切り替え

YouTube / Twitch Clips のサブタブを押した時は、ユーザー操作イベントとして次を送る。

- `event_name: clip_source_tab_click`
- `source: youtube` または `twitch`
- `page: clips`

### YouTube動画クリック

YouTube動画カードがクリックされた時は、外部遷移前に次を送る。

- `event_name: youtube_clip_click`
- `video_id`
- `video_title`
- `player_name`
- `team_name`
- `tier`
- `role`

### Twitchクリップクリック

Twitchクリップカードがクリックされた時は、外部遷移前に次を送る。

- `event_name: twitch_clip_click`
- `clip_id`
- `clip_title`
- `broadcaster_name`
- `creator_name`
- `player_name`
- `team_name`
- `tier`
- `role`

### Twitchクリップ投稿フォームクリック

投稿フォームボタンが押された時は、次を送る。

- `event_name: twitch_clip_submit_form_click`
- `page: clips`
- `source: twitch`

## 二重計測防止

- `page_view` は実際に表示が切り替わった後に1回だけ送る。
- `clip_source_tab_click` はユーザーのサブタブ操作イベントとして送る。
- `page_view` と `clip_source_tab_click` を混同しない。
- `gtag` 未定義時はエラーにしない。
- YouTube/Twitchのカードクリック時は、外部遷移前にイベントを送る。
- 同じ操作でイベントを二重送信しない。

## セキュリティとプライバシー

- `gtag` 未定義時にエラーにしない。
- ユーザー個人情報をGA4イベントに送らない。
- URLに秘密情報を含めない。
- Draft Predictorのadmin系URLは、将来的な公開範囲に注意する。
- イベントパラメータには、個人情報、認証情報、秘密情報を含めない。
