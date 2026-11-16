# Receipt scan (PS 1.65)

The Purchases screen's Scan receipt button (phone only): the page (web `src/views/ReceiptScan.tsx`) takes one still from its
own camera view, as a colour copy (the photo that is saved) and a grey, contrast stretched copy (for the reader), and sends the
grey one as a data URL (`receiptscan:read {id, img}`). `ReceiptScan.kt` reads it with the same offline Tesseract as the gym scan
and answers `{type: "receiptscan", id, text, conf}` or `{..., error: busy|image|model|failed}`. `receiptscan:warm` loads the
reader ahead. The page turns the text into a shop, a date, a total and items (`web/src/core/receiptparse.ts`, tested in
`web/tests/receiptparse.test.ts`), and shows them next to the photo to be checked before Save.

## What ships

| Piece | Where | Size | Licence |
| --- | --- | --- | --- |
| `kat.traineddata` (Georgian, tessdata_fast) | `app/src/main/assets/tessdata/`, from tesseract-ocr/tessdata_fast at 87416418657359cb625c412a48b6e1d6d41c29bd, copied once at build setup | 2.5 MB, sha256 557abb6f1c68bc1b286f1bdd00bb6b82f85a427a91899807dab6c2f6c7986731 | Apache 2.0 |
| `eng.traineddata` (English, tessdata_fast) | same, already there for the gym scan | 4.1 MB, sha256 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 | Apache 2.0 |

The build checks the SHA-256 of `kat`, `eng` and `deu` before every build (`checkTessdata` in `app/build.gradle.kts`), as
`checkTesseractAar` does for the library. Nothing is downloaded at build or run time after that one copy. The models are
copied to `noBackupFilesDir/ocr/tessdata` the first time.

## Privacy

The picture is decoded in memory and the bitmap recycled straight after the read. `ReceiptScan.kt` writes no file and has no
network code. The log line says how many characters were read and how long it took, never the text. On Save the page shrinks
the colour copy to a JPEG of about 90 KB or less and seals it as its own vault file (`blobs`); the receipt record only holds its id.
