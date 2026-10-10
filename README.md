# 硯森營造｜工程儀表板

硯森營造執行中工程的總覽頁，部署在 GitHub Pages。

- 第一層：各工程的決標日、開工日、施工天數、預期完工日、決標金額、監造單位、業主窗口與時程軸。
- 第二層：工程契約（重點摘要、契約全文搜尋、決標公告）、圖說、預算（標單明細）。
- 網頁上可以新增、編輯、刪除工程，變更會直接寫回這個儲存庫。

## 第一次使用（每台裝置一次）

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。
2. Repository access 選 **Only select repositories** → `yansen-dashboard`。
3. Permissions → Repository permissions → **Contents：Read and write**。
4. 打開儀表板，按「GitHub 連線」貼上金鑰。

金鑰只存在該裝置的瀏覽器，不會上傳。

## 資料結構

```
data/projects.json        所有工程的欄位
data/holidays.json        國定假日（工作天計算用）
data/<id>/contract.txt|pdf
data/<id>/draw/*.webp 或 drawings.pdf
data/<id>/award/*.webp 或 award.pdf
data/<id>/budget.json     標單明細（由 Excel 轉出）
```

> 注意：這是公開儲存庫，所有契約、圖說與聯絡資料任何人都看得到。
