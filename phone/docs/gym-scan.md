# Gym scan (V1.59)

The Fitness tab's Scan button: the page (web `src/fitness/Scan.tsx`) takes one still from its own camera
view, crops it to the frame, turns it grey and sends it as a data URL (`gymscan:read {id, img}`). `GymScan.kt` reads
it with Tesseract on the phone and answers `{type: "gymscan", id, text, conf}` or `{..., error: busy|image|model|failed}`.
`gymscan:warm` loads the reader ahead. The page puts the text into English and finds the exercise
(`src/fitness/scan-logic.ts`).

## Why Tesseract

- Runs fully on the phone, needs no Google Play services (GrapheneOS), no network.
- Open source (Apache 2.0), so the public PS build stays open.
- ML Kit's bundled text model also runs without Play, but it is closed source and sends usage metrics to Google.
- Android has no text reader of its own. PaddleOCR or RapidOCR (ONNX) read photos better but weigh 15 MB and more.

## What ships

| Piece | Where | Size | Licence |
| --- | --- | --- | --- |
| Tesseract4Android 4.8.0 (Tesseract 5, Leptonica) | `app/libs/tesseract4android-4.8.0.aar`, copied into the repo (V1.59 merge) from the JitPack release `com.github.adaptech-cz.Tesseract4Android:tesseract4android:4.8.0`, sha256 5bcff63c12baf46bfad9776292c93df62421cec3fe52eb62f03202f49bda8c34 (the same as JitPack's own module file). The build checks it (`checkTesseractAar`) and downloads nothing for it | 12.8 MB in the repo (four ABIs); 7.5 MB native, arm64 only in release | Apache 2.0 (Leptonica: BSD 2 clause) |
| `deu.traineddata` (tessdata_fast) | `app/src/main/assets/tessdata/`, from tesseract-ocr/tessdata_fast at 87416418657359cb625c412a48b6e1d6d41c29bd | 1.5 MB, sha256 19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d | Apache 2.0 |
| `eng.traineddata` (tessdata_fast) | same | 4.1 MB, sha256 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 | Apache 2.0 |

The models are copied to `noBackupFilesDir/ocr/tessdata` the first time (Tesseract reads files, not assets).

## Privacy

The picture is decoded in memory and the bitmap recycled straight after the read. Nothing is written to a file and
nothing is sent; `GymScan.kt` has no network code. The log line says how many letters were read and how long it took,
never the text. The camera permission is the one the Mac code scanner already uses (V1.55, `MainActivity.cameraFor`).
