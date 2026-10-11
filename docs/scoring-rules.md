# 採点ルール（早稲田式・少年野球向け）

このドキュメントは、アプリが **得点・アウト・残塁・打順・試合終了** をどう計算し、記録のどこを「おかしい」と判断するか（整合性チェック C01〜C19）をまとめたものです。

- 開発者向け: 採点ロジックは `src/scoring.js` にあり、この文書の §9 の例題はすべて `tests/scoring.test.js` でテストしています。ルールを変えるときは、この文書とテストを一緒に直してください。
- 保護者・利用者向け: スコアの付け方に自信がなくても、§0 の「基本原則」と §8 のチェック一覧を読めば、アプリが何を確かめているかがわかります。

データの形: `game.atBats[teamKey][inning][key] = セル {resultType, positions, rbi, basesReached, outNumber, runnerEvents, note}`。`teamKey` は `'first'`（先攻＝表）と `'second'`（後攻＝裏）です。

---

## 0. 用語と基本定義

| 用語 | 定義 |
|---|---|
| 半イニング `H` | `(teamKey, inning)` の組。表＝`first`、裏＝`second` の攻撃です |
| `N` | 打順の人数 = `lineup.length`（データがなければ 9）。新しい試合は **DH制でも9人** です。以前のバージョンで作った DH の試合は 10 人のことがあります |
| セル `c` | `atBats[team][inning][key]` に入る1件。**1セル＝1人の選手のその回の行動すべて**（打席の結果に加え、出塁後に走者として起きたこと）を表します |
| `key` | 打席は `String(batterIdx + N × lap)`。ふだんは `lap = 0` で `key = batterIdx`（0始まり）。打者一巡して同じ回に2打席目が来たら `lap = 1`（`key = batterIdx + N`）です。タイブレークの置きランナーは `'tb' + batterIdx` です |
| `L(H)` | `H` の先頭打者の `batterIdx` |
| `seq(H)` | `H` の打席セルを打順の順に並べた列。並び順の値は `order = lap·N + ((b − L + N) mod N)`。置きランナーは含めません |

### フィールドの意味
- `basesReached`: その選手が **安全に到達した最も先の塁** です（1〜3＝塁上、4＝本塁に生還＝得点）。打者アウトは 0 です。走者が進塁したら、その走者のセルを更新します。
  - 出塁したあとアウトになった走者は、最後にいた塁の値のままにして、アウトの走塁イベント（盗塁死・牽制死・走塁死）を付けます。
  - 以前のバージョンのデータでは、アウト以外の結果で `basesReached = 0` のものを「走者アウト」として扱います。
- `runnerEvents`: **そのセルの選手が走者として** 受けた出来事です（`[{type, base?}]`、`base` は進んだ塁またはアウトになった塁）。打席に立っている打者の出来事ではありません。
- `outNumber`: 何アウト目かを示す **表示用** の値（Ⅰ/Ⅱ/Ⅲ）です。アウトの数は `outNumber` ではなく、下の `state` から数えます。

```js
const isPlaced    = c => c.resultType === 'TIEBREAK_RUNNER';             // タイブレークの置きランナー
const isPA        = c => !!c.resultType && !isPlaced(c);                   // 打席
const isBatterOut = c => RESULT_TYPES[c.resultType]?.isOut === true;       // 打者アウト
const isRunnerOut = c => !isBatterOut(c) && (
  c.runnerEvents.some(e => RUNNER_EVENTS[e.type]?.isOut)                  // 盗塁死・牽制死・走塁死
  || (isPA(c) && c.basesReached === 0));                                   // 以前のデータの走者アウト
const state = c => !c.resultType ? 'EMPTY'                                 // 結果が未選択
  : (isBatterOut(c) || isRunnerOut(c)) ? 'OUT'
  : c.basesReached === 4 ? 'SCORED' : 'ON_BASE';
```

**基本原則（保護者向けの説明）:** 打席に立った選手は、その回の最後に必ず次のどれか1つになります。
- ホームに還った（得点）
- アウトになった
- 塁に残った（残塁）

この原則から、半イニングが終わっていれば次の式が必ず成り立ちます。

**打者数 ＋ 置きランナー数 ＝ 得点 ＋ 残塁 ＋ アウト(3)**（公認野球規則 9.03(c) の試合記録の照合）

---

## 1. 打撃結果ごとの扱い

| resultType | 打者アウト | 既定の `basesReached` | 打席 | 打数 | 安打 | 打点（許容範囲） | 守備側の失策 | 必要な状況 |
|---|---|---|---|---|---|---|---|---|
| GROUNDOUT ゴロ | ○ | 0 | ○ | ○ | – | 0〜走者数（通常0〜1）。3アウト目なら0 | – | – |
| FLYOUT フライ | ○ | 0 | ○ | ○ | – | 0（得点が入ったら SACRIFICE_FLY にする） | – | – |
| LINEOUT ライナー | ○ | 0 | ○ | ○ | – | 0 | – | – |
| STRIKEOUT_SWING / STRIKEOUT_LOOK 三振 | ○ | 0 | ○ | ○ | – | **0** | – | – |
| DOUBLE_PLAY 併殺打 | ○（このセルは打者の1アウトだけ） | 0 | ○ | ○ | – | **0**（規則 9.04(b)） | – | 走者が1人以上、それまでのアウトが1以下 |
| INFIELD_FLY | ○ | 0 | ○ | ○ | – | **0** | – | 0・1アウトで、一・二塁か満塁（走者2人以上） |
| SINGLE / DOUBLE / TRIPLE | – | 1 / 2 / 3 | ○ | ○ | ○ | 0〜3 | – | – |
| HOMERUN | – | **4（必須）** | ○ | ○ | ○ | **1〜4**（＝走者数＋1） | – | – |
| WALK 四球 / INTENTIONAL_WALK 敬遠 / HIT_BY_PITCH 死球 | – | 1 | ○ | **–** | – | 0〜1（1は満塁の押し出しだけ） | – | – |
| SACRIFICE_BUNT 犠打 | ○ | 0 | ○ | **–** | – | 0〜1（スクイズで1） | – | 走者が1人以上、それまでのアウトが1以下 |
| SACRIFICE_FLY 犠飛 | ○ | 0 | ○ | **–** | – | **1以上（必須）** | – | 走者が1人以上、それまでのアウトが1以下 |
| ERROR エラー | – | 1 | ○ | ○ | **–** | 原則0（例外: 0・1アウトで、エラーがなくても還れた三塁走者の得点なら1） | **+1** | – |
| FIELDERS_CHOICE 野選 | – | 1 | ○ | ○ | – | 0〜3（併殺の場合は0） | – | 走者が1人以上 |
| STRIKEOUT_WILD 振り逃げ | – | 1 | ○ | ○ | – | **0** | – | – |
| INTERFERENCE 打撃妨害 | – | 1 | ○ | **–** | – | 0〜1（満塁のときだけ） | **+1（捕手）** | – |
| TIEBREAK_RUNNER 置きランナー | – | 1 または 2 | **–** | – | – | 0 | – | タイブレークの回だけ |

### 補足
- **打数 (AB)** ＝ 打席数 − (四球 + 敬遠 + 死球 + 犠打 + 犠飛 + 打撃妨害)。
- 走者アウトで3アウト目になり、打席の途中で回が終わった打者にはセルを作りません。打席にも数えません（その打者が次の回の先頭打者です。§4）。
- **併殺 (DP)**: 2アウトは2つのセルに分けて記録します。DOUBLE_PLAY のセルが打者の1アウト、一緒にアウトになった走者のセルが `RUNNER_OUT`（走塁死）でもう1アウトです。早稲田式の紙のスコアと同じ書き方です。
  - `RESULT_TYPES.DOUBLE_PLAY.outsCount: 2` は「このプレー全体で2アウト」という意味の情報にすぎません。アウト数を数えるときに足してはいけません。
  - ライナーの併殺（LINEOUT ＋ 走者のアウト）や三重殺も同じ方法で表せます。
- 振り逃げは三振として記録されますが（個人成績の「三振」に数えます）、打者はアウトになりません。
- 入力パネルから保存するときは、結果に合わない値が自動で直されます（アウトなのに塁や走塁イベントがある、打点のつかない結果の打点、本塁打の到達塁など）。

### 走塁イベント（`runnerEvents`。そのセルの選手に起きたこと）

| type | 意味 | この走者への効果 | アウト | 打点 | 失策 |
|---|---|---|---|---|---|
| STOLEN_BASE (S) | 盗塁 | 1つ進塁 | – | なし | – |
| WILD_PITCH (WP) / PASSED_BALL (PB) / BALK (BK) | 暴投 / 捕逸 / ボーク | 1つ進塁 | – | **なし**（生還しても打点はつかない） | 失策ではない |
| ADVANCE_ON_ERROR (E) | 失策で進塁 | 1つ以上進塁 | – | なし | +1 |
| CAUGHT_STEALING (CS) | 盗塁死 | アウト | +1 | – | – |
| PICKOFF (PO) | 牽制死 | アウト | +1 | – | – |
| RUNNER_OUT (T.O) | 走塁死（封殺・タッチアウト・飛び出し） | アウト | +1 | – | – |

1つのセルに付けられるアウトの出来事（CS・PO・T.O）は1回だけです。

---

## 2. 得点と打点

1. **得点:** `R(H) = |{c ∈ H : state(c) === 'SCORED'}|`。置きランナーの生還も得点に含めます。**打点 (`rbi`) を得点に足してはいけません**（ソロ本塁打は1点です）。
2. 走者が還ったときは、**その走者のセルを「得点」（`basesReached = 4`）にします**。還した打者のセルには打点を入れます。入力パネルでは、打者の結果と同時に塁上の走者の行き先を選べます。
3. **得点と打点の関係:** `Σ rbi(H) ≤ R(H)`。1つの得点に打点がつくのは打者1人だけです。
4. **打点がつく場合（規則 9.04）**
   - 安打、犠打、犠飛、内野ゴロ、野選の間に走者が還ったとき
   - 満塁での四球・死球・打撃妨害（押し出し）
   - 本塁打の打者自身
   - 0・1アウトで、普通なら三塁走者が還れたプレーでエラーが起きたとき
5. **得点は入るが打点がつかない場合**
   - 併殺打（封殺・逆封殺）の間の得点
   - 暴投・捕逸・ボーク・盗塁（本盗）・牽制悪送球など、打撃と関係のない得点
   - エラーがなければ3アウト目になっていたプレーでの得点
   - 打者がエラーで出塁した打席での得点（上の例外を除く）
6. **得点にならない場合（規則 5.08(a)）:** 次のどれかで3アウト目になったプレーでは、本塁に入った走者がいても得点になりません。
   - 打者走者が一塁に触れる前にアウトになった（例: 2アウト三塁でショートゴロ）
   - 封殺
   - 前の走者の塁の踏み忘れ
7. **サヨナラ（規則 5.08(b)・9.06(f)）:** 決勝点が入った時点で試合は終わります。決勝点より後の走者の得点は数えません。ただし、柵越えの本塁打だけは全員の得点が入ります。

---

## 3. アウトの数え方（半イニングごと）

- `outs(H) = |{c ∈ H : state(c) === 'OUT'}|`。**アウト1つにつき、アウトになった本人のセル1つ** に記録します。
  - 打者アウト（isOut のすべての結果。犠打・犠飛・併殺打を含む）
  - 走者アウト（盗塁死・牽制死・走塁死、または以前のデータで打席の結果がアウト以外なのに `basesReached === 0` のもの）
  - 併殺は「DPのセル＋走者のセル」で2アウトになります。
- **`outNumber` の振り方**（半イニングごとに、記録した順に 1, 2, 3）
  - 新しくアウトになったセル: `outNumber = (このセルを除いた outs(H)) + 1`。
  - 打者の結果と一緒に走者の更新を保存するときは、**走者を先に** 処理します。そのため併殺では走者が小さい番号（例: 走者Ⅰ、打者Ⅱ）になります。
  - すでにアウトのセルを直して保存しても、番号は変わりません。番号を選び直したときは、その番号を優先して残りを詰め直します（盗塁死が後の打者の打席中に起きたときなど）。
  - アウトを取り消したり（クリア・安打への変更）、セルを消したりしたときは、残りの番号を 1 から詰め直します。
- **ありえない状態**
  - `outs(H) > 3`
  - `outNumber` が {1,2,3} 以外、同じ半イニング内で重複、アウトなのに番号がない、または OUT ではないセルに付いている
  - **打者アウトが3つ出た後の打席**（その打者より前に `isBatterOut` のセルが3つある）
  - 終わった半イニングでアウトが3つ未満（例外は、試合がその半イニングで終わった場合: サヨナラ・コールド・時間切れ）
- 半イニングが「終わった（完了）」とは、`outs(H) ≥ 3`、試合がその半イニングで終わった、または **それより後の半イニング（どちらのチームでも）に記録がある**、のどれかです。置きランナーが置かれただけの半イニングは「記録がある」に入りません。

---

## 4. 打順の連続性

- 各チームの1回の先頭打者は `L(team, 1) = 0`（1番）です。
- 次の回の先頭打者は `L(team, n+1) = (b_last + 1) mod N` です。`b_last` は `seq(team, n)` の最後のセルの `batterIdx` です（置きランナーは含めません）。
  - 3アウト目が走者アウトで、そのとき打席にいた打者の打席が終わっていない場合、その打者にはセルがありません。そのため **その打者が次の回の先頭打者** になります（例題 E8）。
  - 記録のない半イニングがあるときは、記録のある直近の半イニングから続けて数えます（片方のチームだけを記録する使い方もできます）。
- `seq(H)` は `L(H)` から **途中を飛ばさずに連続** していなければなりません（並び順の値が 0,1,…,k−1）。
- **同じ回に同じ打者が2回打てるのは、打者一巡（その回の打席が N を超えた）のときだけ** です。2打席目は `key = b + N`、3打席目は `b + 2N` に保存します（例題 E12）。
- 代打・代走は同じ打順の枠を使い続けます。`batterIdx` は変わりません。
- **タイブレーク（継続打順。一般的な大会規定）**
  - `1B2B`: 一塁 = 枠 `(L−1) mod N`、二塁 = 枠 `(L−2) mod N`
  - `1B`: 一塁 = `(L−1)`
  - `2B`: 二塁 = `(L−1)`
  - 置きランナーは `key = 'tb' + batterIdx` のセルとして、`tiebreakerInning` 以降の回で、その回の開始時点で同点のときに、前の回が終わった後で自動的に置きます（すでにあれば何もしません）。
  - 置きランナーはその回の打者ではありません。打席・打数に数えず、打順の連続性の判定にも、次の回の先頭打者の計算にも使いません。
  - 置きランナーも、生還すれば得点、残れば残塁、アウトになればアウトに数えます。

---

## 5. 残塁 (LOB)

- チームの残塁は `LOB(H) = |{c ∈ H : state(c) === 'ON_BASE'}|` を、半イニングが終わった時点（3アウト、または試合終了）で数えます。値は **必ず 0〜3** です。進行中の半イニングの残塁は 0 として扱い、塁上の走者は「いま塁上にいる走者」として表示します。
- **照合式:** `打席数(H) + 置きランナー(H) = R(H) + LOB(H) + outs(H)`
- 個人の「残」は、その選手のセルが半イニング終了時に `ON_BASE` だった回数です。
- 試合全体の残塁は `Σ LOB(H)` です。

---

## 6. 一致しなければならない合計

1. スコアボードの各回の得点 = `R(H)`（得点したセルの数）。
   - まだ行っていない半イニングは空欄、0点の半イニングは「0」、不要になった裏は「X」と表示します。
2. 合計得点 `R(team) = Σ R(H)` = 選手ごとの得点の合計。
3. 打点の合計 `Σ rbi ≤ R(team)`。半イニングごとにも成り立ちます。
4. 安打 = 安打セル（SINGLE / DOUBLE / TRIPLE / HOMERUN）の数 = 選手ごとの安打の合計。
5. **チームXの失策** = **相手チームの攻撃のセル** にある ERROR と INTERFERENCE の数 ＋ 走塁イベントの ADVANCE_ON_ERROR の数。
6. 打席数 = 打数 + 四球 + 敬遠 + 死球 + 犠打 + 犠飛 + 打撃妨害。
7. チームごとに `Σ打席 + Σ置きランナー = R + LOB + アウト合計` が成り立ちます。アウト合計 = 3 × 完了した半イニングの数 + 最後の未完了の半イニングのアウト数です。
8. 選手ごとの列は1つの意味だけを持たせます。「打点」と「得点」は別の列にし、合計行は列の値を合計したものにします。

---

## 7. 試合終了のルール（少年野球）

- **正規の回数** `R_reg = game.innings` は試合ごとの設定です（既定は7回。学童は大会により6〜7回で時間制限つき、中学は7回、一般は9回が多く、大会要項が優先です）。
- `n ≥ R_reg` の表が終わった時点で後攻がリードしていれば、**その回の裏は行いません**（スコアボードは X）。
- `n ≥ R_reg` の回を最後まで終えて同点でなければ試合終了です。同点なら延長に入ります（`tiebreakerInning` 以降はタイブレーク）。
  - 延長はアプリの上限（12回）までです。12回を終えて同点なら引き分けとして試合終了です（抽選などの結果は `gameResult` に記録します）。
- **サヨナラ:** `n ≥ R_reg` の裏で後攻が勝ち越した瞬間に試合終了です。その後の打席はありません。アウトが3つ未満でも有効です。点差は本塁打を除いて1点までです。
- **タイブレーク:** 0アウト、設定どおりの置きランナー、継続打順で始めます。その回の開始時点で同点の場合だけ適用します。
- **コールド・時間切れ:** 大会規定に従います。試合の設定で `status = 'final'`、`endReason = 'called'`（コールド）または `'time'`（時間切れ）にすると、最後に記録した半イニングで試合終了になります。アウトが3つ未満でもかまいません。表で終わって後攻がリードしていれば、その回の裏は X です。
- 両チームの記録があるときだけ、上のルールで自動的に試合終了を判定します（片方のチームだけを記録しているときは、`status = 'final'` で終了にします）。
- 参考（学童大会要項の例: 7回からタイブレーク、継続打順で前の回の最終打者が一塁走者、その前の打者が二塁走者）:
  - [魚津市 学童大会要項(PDF)](https://uyakyu.spo-uozu.com/blog/wp-content/uploads/2025/06/e52ae4f5540006c094083e6ec748e4ac.pdf)
  - [NPB 女子野球大会規定](https://npb.jp/girls/2025/rule.html)

---

## 8. 整合性チェック一覧

重要度の意味:
- **error**: 記録として成り立たない（赤で表示し、直すように促す）
- **warning**: たぶん間違い（黄）
- **info**: 確認のお願い

メッセージの `{回}` は「3回表」のような表記、`{打者}` は「4番 田中」（名前がなければ「4番」）です。セルに関するメッセージは「3回表 4番 田中：…」のように場所から始まります。

使う記号:
- `BO_before(c)` = `seq` の中で `c` より前にある打者アウトのセルの数（その時点のアウト数の下限）
- `RB_before(c)` = 置きランナーの数 ＋ `seq` の中で `c` より前にある、打者アウトでないセルの数（その時点で塁上にいたかもしれない走者数の上限）

| ID | 重要度 | 条件 | メッセージ（保護者向け） |
|---|---|---|---|
| C01 | error | `Σrbi(H) > R(H)` | 「{回}：打点が{rbi}なのに得点は{runs}点です。ホームに還った走者のマスを開いて『得点』を選んでください。」 |
| C02 | error / warning | `ON_BASE` のセルが4つ以上（error）。`ON_BASE` のセル2つ以上の `basesReached` が同じ（終わった半イニングでは error、進行中は warning） | 「塁上に{k}人いることになっています（塁は3つだけです）。還った走者は『得点』、アウトになった走者は『走塁死』にしてください。」／「{a}と{b}が両方とも{塁}にいます。押し出された走者の塁を進めてください。」 |
| C03 | error | 終わった `H` で `outs(H) < 3`（試合がその回で終わった場合と、記録が1つもない半イニングは除く） | 「{回}はアウトが{outs}つしか記録されていません。三振・ゴロの入力漏れや、盗塁死・走塁死・併殺でアウトになった走者の記入漏れがないか確認してください。」 |
| C04 | error | `outs(H) > 3`、`outNumber` が {1,2,3} 以外か重複、アウトなのに番号がない、または OUT でないセルに `outNumber` がある | 「{回}：アウトが{outs}つあります。1イニングのアウトは3つまでです。」／「『{k}アウト目』が2人います。」など |
| C05 | error | `seq(H)` の中に `BO_before(c) ≥ 3` のセルがある | 「{回}：3アウトでチェンジした後に{打者}の打席が入っています。次の回の欄ではありませんか？」 |
| C06 | error | 最初に記録された打者が `L(H)` でない | 「{回}の先頭打者は{L}のはずです（前の回は{last}で終わりました）。{x}から記録されています。」 |
| C07 | error | 打順の並びが連続していない（C06 が出たときは出さない） | 「{回}：{a}の次に{b}が記録されていて、間の打者の結果が空いています。」 |
| C08 | error | `seq(H)` で j番目の DOUBLE_PLAY より前にある走者アウトのセルが j 個未満 | 「併殺打ですが、一緒にアウトになった走者のマスに『走塁死』が付いていません。」 |
| C09 | error | (a) 犠打・犠飛・IF・DP で `BO_before ≥ 2`<br>(b) 犠打・犠飛・DP・FC で `RB_before = 0`<br>(c) IF で `RB_before < 2` | (a)「2アウトからは{結果}になりません。普通の〜です。」<br>(b)「ランナーがいないのに{結果}になっています。」<br>(c)「インフィールドフライは0・1アウトで一・二塁か満塁のときだけです。」 |
| C10 | error | SACRIFICE_FLY で `rbi < 1` | 「犠牲フライは走者が還ったときだけ使います。打点を1にして、還った走者を『得点』にしてください（得点がなければ普通のフライアウトです）。」 |
| C11 | error / warning | error: 三振・振り逃げ・DP・IF に `rbi > 0`、または打者アウトで `outNumber = 3` なのに `rbi > 0`<br>warning: FLYOUT・LINEOUT・ERROR に `rbi > 0` | 「{結果}には打点がつきません。」／「3アウト目のアウトの間の得点は認められません。」／「フライで点が入ったなら『犠飛』では？」／「エラーの間の得点には普通は打点がつきません。」 |
| C12 | error | HOMERUN で `basesReached ≠ 4` か `rbi < 1`。`rbi > min(3（本塁打は4）, RB_before + (本塁打なら1))`。四球・敬遠・死球・打撃妨害で `rbi > 1`、または `rbi = 1` なのに `RB_before < 3` | 「ホームランは打者自身も得点し、打点は1以上です。」／「打点{rbi}は、塁上の走者の数から考えて多すぎます。」／「押し出しは満塁のときだけです。」 |
| C13 | error | 打者アウトのセルで `basesReached > 0`、または `runnerEvents` がある | 「{結果}でアウトなのに、塁に出た（盗塁などの）記録があります。」 |
| C14 | error | アウトの走塁イベントが2つ以上ある、またはアウトの走塁イベントと `basesReached = 4` が両方ある | 「『得点』と『アウト』の両方が記録されています。」／「アウトの記録が2つあります。」 |
| C15 | warning | OUT でない打席セルで `basesReached < min(4, bases(結果) + 進塁イベントの数)` | 「{結果}（と盗塁など）で{期待}まで進んだはずですが、{実際}のままです。」 |
| C16 | error | 試合が終わった後の記録がある。(i) `n ≥ R_reg` の表を終えて後攻がリードしているのに `n` 回裏の記録がある。(ii) サヨナラの後の半イニングに記録がある。(iii) 同点でないのに延長の回に記録がある | 「{n}回表を終えて後攻チームがリードしているので、{n}回裏の攻撃はありません（スコアボードは X）。」／「試合はすでに{回}で終わっているので、この回の記録は不要です。」 |
| C17 | warning | サヨナラで終わり、点差が2以上で、その回の最後の打席が本塁打ではない | 「サヨナラの場合、勝ち越し点が入った時点で試合終了です（本塁打を除く）。その後の得点や打者が入っていないか確認してください。」 |
| C18 | warning / info | warning: 結果が選ばれていないセル（置きランナー以外）<br>info: 打席の結果がアウト以外で `basesReached = 0` なのにアウトの走塁イベントがない | 「打席結果が選ばれていません。」／「アウトになった理由（盗塁死・走塁死）を記録すると、後で見返しやすくなります。」 |
| C19 | warning | タイブレークの回で、置きランナーの人数・塁・打順の枠が設定（§4）と違う。タイブレークではない回に置きランナーがある | 「{回}：タイブレークの最初のランナーは{x}（一塁）と{y}（二塁）のはずです。」／「{回}はタイブレークの回ではないのに、置きランナーが入っています。」 |

### 利用者向けの確認表示
- 半イニングごとに「回のまとめ」を表示します。例:
  > 打者5人：得点1・残塁1・アウト3 ✓

  ✓ は §5 の照合式が成り立ち、半イニングが終わっているときに付きます。
- セルを、見たままの言葉で読み上げます。例:
  > 4番 田中：レフト前ヒット → 盗塁 → 得点
- チェックの一覧から、該当するセルへ移動できます。

---

## 9. 例題（テスト用データ）

各例題は1つの半イニングです。`cells` の各要素は、省略したフィールドを既定値（`rbi:0, basesReached:0, outNumber:null, runnerEvents:[]`）とします。`T(x)` は `{type:x}` の略です。`nextLeadoff` は次の回の先頭打者の `batterIdx` です。このデータは `tests/examples.js` にあり、`tests/scoring.test.js` で検証しています。

```js
const T = type => ({ type });
export const VALID = [
 { id:'E1', note:'三者凡退（1番ショートゴロ、2番センターフライ、3番空振り三振）', N:9, L:0, cells:{
   0:{resultType:'GROUNDOUT',positions:'6-3',outNumber:1},
   1:{resultType:'FLYOUT',positions:'8',outNumber:2},
   2:{resultType:'STRIKEOUT_SWING',outNumber:3} },
   expect:{outs:3,runs:0,rbi:0,hits:0,lob:0,pa:3,ab:3,nextLeadoff:3} },
 { id:'E2', note:'4番レフト前、5番中堅への二塁打で4番生還、後続凡退', N:9, L:3, cells:{
   3:{resultType:'SINGLE',positions:'7',basesReached:4},
   4:{resultType:'DOUBLE',positions:'8',rbi:1,basesReached:2},
   5:{resultType:'STRIKEOUT_LOOK',outNumber:1},
   6:{resultType:'GROUNDOUT',positions:'6-3',outNumber:2},
   7:{resultType:'FLYOUT',positions:'9',outNumber:3} },
   expect:{outs:3,runs:1,rbi:1,hits:2,lob:1,pa:5,ab:5,nextLeadoff:8} },
 { id:'E3', note:'9番四球、1番2ラン本塁打', N:9, L:8, cells:{
   8:{resultType:'WALK',basesReached:4},
   0:{resultType:'HOMERUN',rbi:2,basesReached:4},
   1:{resultType:'GROUNDOUT',positions:'4-3',outNumber:1},
   2:{resultType:'STRIKEOUT_SWING',outNumber:2},
   3:{resultType:'LINEOUT',positions:'6',outNumber:3} },
   expect:{outs:3,runs:2,rbi:2,hits:1,lob:0,pa:5,ab:4,nextLeadoff:4} },
 { id:'E4', note:'1番E6で出塁→盗塁→暴投で生還（打点0）。守備側の失策+1', N:9, L:0, cells:{
   0:{resultType:'ERROR',positions:'6',basesReached:4,runnerEvents:[T('STOLEN_BASE'),T('WILD_PITCH')]},
   1:{resultType:'GROUNDOUT',positions:'4-3',outNumber:1},
   2:{resultType:'STRIKEOUT_SWING',outNumber:2},
   3:{resultType:'FLYOUT',positions:'7',outNumber:3} },
   expect:{outs:3,runs:1,rbi:0,hits:0,lob:0,pa:4,ab:4,errorsChargedToDefense:1,nextLeadoff:4} },
 { id:'E5', note:'5番二塁打、6番単打、7番6-4-3併殺（6番が二塁で封殺）の間に5番生還＝打点0', N:9, L:4, cells:{
   4:{resultType:'DOUBLE',positions:'7',basesReached:4},
   5:{resultType:'SINGLE',positions:'8',basesReached:1,runnerEvents:[T('RUNNER_OUT')],outNumber:1},
   6:{resultType:'DOUBLE_PLAY',positions:'6-4-3',outNumber:2},
   7:{resultType:'STRIKEOUT_LOOK',outNumber:3} },
   expect:{outs:3,runs:1,rbi:0,hits:2,lob:0,pa:4,ab:4,nextLeadoff:8} },
 { id:'E6', note:'2番四球、3番犠打、4番単打、5番犠飛で2番生還、6番ゴロ（4番は残塁）', N:9, L:1, cells:{
   1:{resultType:'WALK',basesReached:4},
   2:{resultType:'SACRIFICE_BUNT',positions:'1-3',outNumber:1},
   3:{resultType:'SINGLE',positions:'9',basesReached:1},
   4:{resultType:'SACRIFICE_FLY',positions:'8',rbi:1,outNumber:2},
   5:{resultType:'GROUNDOUT',positions:'5-3',outNumber:3} },
   expect:{outs:3,runs:1,rbi:1,hits:1,lob:1,pa:5,ab:2,nextLeadoff:6} },
 { id:'E7', note:'四球・死球・四球で満塁→押し出し、その後3アウトで満塁残塁', N:9, L:6, cells:{
   6:{resultType:'WALK',basesReached:4},
   7:{resultType:'HIT_BY_PITCH',basesReached:3},
   8:{resultType:'WALK',basesReached:2},
   0:{resultType:'WALK',rbi:1,basesReached:1},
   1:{resultType:'STRIKEOUT_SWING',outNumber:1},
   2:{resultType:'FLYOUT',positions:'7',outNumber:2},
   3:{resultType:'GROUNDOUT',positions:'6-3',outNumber:3} },
   expect:{outs:3,runs:1,rbi:1,hits:0,lob:3,pa:7,ab:3,nextLeadoff:4} },
 { id:'E8', note:'3番単打、4・5番三振、6番の打席中に3番盗塁死→次の回は6番から', N:9, L:2, cells:{
   2:{resultType:'SINGLE',positions:'7',basesReached:1,runnerEvents:[T('CAUGHT_STEALING')],outNumber:3},
   3:{resultType:'STRIKEOUT_SWING',outNumber:1},
   4:{resultType:'STRIKEOUT_LOOK',outNumber:2} },
   expect:{outs:3,runs:0,rbi:0,hits:1,lob:0,pa:3,ab:3,nextLeadoff:5} },
 { id:'E9', note:'1番単打で二塁を狙ってアウト、2番単打、3番野選（2番が二塁で封殺）、4番一ゴロ（3番は二塁へ進み残塁）', N:9, L:0, cells:{
   0:{resultType:'SINGLE',positions:'8',basesReached:1,runnerEvents:[T('RUNNER_OUT')],outNumber:1},
   1:{resultType:'SINGLE',positions:'7',basesReached:1,runnerEvents:[T('RUNNER_OUT')],outNumber:2},
   2:{resultType:'FIELDERS_CHOICE',positions:'6-4',basesReached:2},
   3:{resultType:'GROUNDOUT',positions:'3',outNumber:3} },
   expect:{outs:3,runs:0,rbi:0,hits:2,lob:1,pa:4,ab:4,nextLeadoff:4} },
 { id:'E10', note:'タイブレーク(1B2B, 継続打順, 前の回は4番で終了)。置きランナー 一塁=4番, 二塁=3番。5番犠打、6番2点適時打、7番4-6-3併殺', N:9, L:4, cells:{
   tb3:{resultType:'TIEBREAK_RUNNER',basesReached:4,batterIdx:3},
   tb2:{resultType:'TIEBREAK_RUNNER',basesReached:4,batterIdx:2},
   4:{resultType:'SACRIFICE_BUNT',positions:'1-4',outNumber:1},
   5:{resultType:'SINGLE',positions:'8',rbi:2,basesReached:1,runnerEvents:[T('RUNNER_OUT')],outNumber:2},
   6:{resultType:'DOUBLE_PLAY',positions:'4-6-3',outNumber:3} },
   expect:{outs:3,runs:2,rbi:2,hits:1,lob:0,pa:3,ab:2,placed:2,nextLeadoff:7} },
 { id:'E11', note:'最終回の裏・同点。1番四球、2番犠打、3番サヨナラ打（試合終了。アウト1でも完了扱い）', N:9, L:0, gameEndsHere:true, cells:{
   0:{resultType:'WALK',basesReached:4},
   1:{resultType:'SACRIFICE_BUNT',positions:'2-3',outNumber:1},
   2:{resultType:'SINGLE',positions:'9',rbi:1,basesReached:1} },
   expect:{outs:1,runs:1,rbi:1,hits:1,lob:1,pa:3,ab:1,nextLeadoff:3} },
 { id:'E12', note:'打者一巡。1番の2打席目は key=0+9=9', N:9, L:0, cells:{
   0:{resultType:'SINGLE',positions:'7',basesReached:4},
   1:{resultType:'WALK',basesReached:4},
   2:{resultType:'DOUBLE',positions:'8',rbi:2,basesReached:4},
   3:{resultType:'SINGLE',positions:'9',rbi:1,basesReached:4},
   4:{resultType:'STRIKEOUT_SWING',outNumber:1},
   5:{resultType:'HOMERUN',rbi:2,basesReached:4},
   6:{resultType:'GROUNDOUT',positions:'6-3',outNumber:2},
   7:{resultType:'ERROR',positions:'5',basesReached:2},
   8:{resultType:'WALK',basesReached:1},
   9:{resultType:'FLYOUT',positions:'8',outNumber:3} },
   expect:{outs:3,runs:5,rbi:5,hits:4,lob:2,pa:10,ab:8,errorsChargedToDefense:1,nextLeadoff:1} },
];
// E1〜E12 はどれもチェックが0件になります。
export const INVALID = [
 { id:'X1', note:'還った1番を得点にし忘れ', N:9, L:0, cells:{
   0:{resultType:'SINGLE',positions:'7',basesReached:1},
   1:{resultType:'DOUBLE',positions:'8',rbi:1,basesReached:2},
   2:{resultType:'STRIKEOUT_SWING',outNumber:1},
   3:{resultType:'FLYOUT',positions:'9',outNumber:2},
   4:{resultType:'GROUNDOUT',positions:'6-3',outNumber:3} }, expectChecks:['C01'] },
 { id:'X2', note:'3アウト後に4番', N:9, L:0, cells:{
   0:{resultType:'GROUNDOUT',positions:'6-3',outNumber:1},
   1:{resultType:'FLYOUT',positions:'8',outNumber:2},
   2:{resultType:'STRIKEOUT_SWING',outNumber:3},
   3:{resultType:'SINGLE',positions:'7',basesReached:1} }, expectChecks:['C05'] },
 { id:'X3', note:'2アウトから犠飛・打点0', N:9, L:0, cells:{
   0:{resultType:'TRIPLE',positions:'8',basesReached:3},
   1:{resultType:'STRIKEOUT_SWING',outNumber:1},
   2:{resultType:'STRIKEOUT_LOOK',outNumber:2},
   3:{resultType:'SACRIFICE_FLY',positions:'9',outNumber:3} }, expectChecks:['C09','C10'] },
 { id:'X4', note:'併殺なのに走者アウトの記入がなく、アウト2つで次の回へ（後の半イニングに記録あり）', N:9, L:0, completed:true, cells:{
   0:{resultType:'SINGLE',positions:'7',basesReached:1},
   1:{resultType:'DOUBLE_PLAY',positions:'6-4-3',outNumber:2},
   2:{resultType:'GROUNDOUT',positions:'5-3',outNumber:3} }, expectChecks:['C03','C08'] },
 { id:'X5', note:'前の回は3番で終了（L=3）なのに6番から記録', N:9, L:3, cells:{
   5:{resultType:'GROUNDOUT',positions:'6-3',outNumber:1},
   6:{resultType:'FLYOUT',positions:'8',outNumber:2},
   7:{resultType:'STRIKEOUT_SWING',outNumber:3} }, expectChecks:['C06'] },
 { id:'X6', note:'HRなのに打点0／二塁打なのに一塁／同じ塁に2人（進行中）', N:9, L:0, cells:{
   0:{resultType:'HOMERUN',basesReached:4},
   1:{resultType:'DOUBLE',positions:'9',basesReached:1},
   2:{resultType:'SINGLE',positions:'7',basesReached:1} }, expectChecks:['C02(warning)','C12','C15'] },
];
```

### 試合全体の例
- **G1**（7回制）
  - 先攻: 0,1,0,2,0,0,0 = 3点
  - 後攻: 1,0,2,0,1,0,X = 4点
  - 7回表を終えて後攻がリードしているので、7回裏は X と表示します。7回裏にセルが1つでもあれば C16 を出します。
- **G2**: 7回裏、3-3の同点から後攻が3点を取り、最後の打席が DOUBLE の場合は C17（warning）を出します。

---

## 10. 開発者向けメモ

- `src/scoring.js` は DOM や localStorage に触れない純粋な関数の集まりで、`GameData` のインスタンスでも、保存した JSON をそのまま読み込んだオブジェクトでも動きます。読み込みに使うのは `src/rules.js` だけです。
- 主な関数:
  - 集計: `halfInning`（半イニングのアウト・得点・残塁・塁上の走者・次の打者など）、`inningRuns`、`scoreboard`、`teamTotals`、`playerLine`、`liveState`（いま記録すべき半イニング）、`gameEndState`
  - チェック: `validateGame`（§8 の C01〜C19）
  - 記録: `recordPlateAppearance`（結果の整形、走者の更新、アウト番号の付け直し）、`clearCell`、`renumberOuts`、`ensureTiebreakRunners`
  - 移行: `normalizeGame`（以前のバージョンの保存データを v2 に変換。試合全体で共有していた `outsInInning` を消し、アウト番号を打順どおりに振り直します）
- 計算結果は保存しません。毎回セルから計算し直すので、セルを直せばスコアボード・合計・チェックがすべて一緒に変わります。
- テストの実行: `npm test`
