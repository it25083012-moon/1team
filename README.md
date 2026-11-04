# [プロジェクト名] 〜みんなで作る、安心できる居場所〜

## 4週間のステップアップ・ロードマップ

| 週 | 人数 | テーマ | ミッション |
|------|------|---|---|
| Week 1 | 1人 | じっくり自分探しの週 | マイペースに、自分だけのプロフィールニックネームや「こころステッカー」、自分を表現する小さなアイテムを描く |
| Week 2 | 2人 | ペアと一緒に | 2人1組でペアマッチング。1週間かけて「はんぶんこAIキャラクター」を描く |
| Week 3 | 4〜10人 | 小グループチームミッション | グループごとに集まり、「みんなで作る特製カレーのレシピ＆物語」を完成させる |
| Week 4 | 20人 | 全員で合体！最終大イベント | 1週間で材料を準備し、オフライン（対面）でカレー作りパーティーを開催 |

1週間単位で課題をクリアしていく流れが、メインページのロードマップで見えるようになっています。


# tiny-slugify

https://edogawa.shuregakuen.ed.jp/school/
https://npo-lh.com/activities/free-school/

## 特長



## 動作環境

| 項目 | バージョン |
| --- | --- |
| HTML |
| CSS |
| PHP |
| CSS |
| CSS |
| CSS |

## インストール

```bash
npm install tiny-slugify
```

## 使い方

```js
import { slugify } from "tiny-slugify";

console.log(slugify("Hello World 2026"));
// => "hello-world-2026"

console.log(slugify("在庫 一覧", { separator: "_" }));
// => "在庫_一覧"
```

## API

### slugify(input, options?)

| 引数 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `input` | `string` | （必須） | 変換する文字列 |
| `options.separator` | `string` | `"-"` | 単語の区切り文字 |
| `options.maxLength` | `number` | `80` | 最大文字数。超えた分は切り捨てます |

戻り値は `string` です。`input` が文字列でないときは `TypeError` を投げます。

## 変更履歴

[CHANGELOG.md](CHANGELOG.md) を参照してください。

## コントリビュート

不具合報告や改善提案は Issue でお知らせください。開発の始め方は [CONTRIBUTING.md](CONTRIBUTING.md) にまとめています。

## ライセンス

[MIT](LICENSE)
