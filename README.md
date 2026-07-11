# Netflixy Mobile

Netflix WebView app — fetches your session cookies from your own API and injects them natively so Netflix loads fully authenticated.

---

## Get the APK (GitHub Actions — no Android Studio, no Expo account needed)

### 1. Push this repo to GitHub

Upload every file/folder in this project to the root of your GitHub repo — including the hidden `.github` and `.npmrc` files (hidden folders/files won't show in drag-and-drop file pickers on some systems; use "reveal hidden files" or GitHub's "Create new file" with the full path typed in, e.g. `.github/workflows/build-android.yml`).

If pushing with git instead:
```bash
git init
git add .
git commit -m "Netflixy mobile"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

**Important:** If GitHub suggests adding an "Expo"/"EAS" workflow, decline it — this project only needs `build-android.yml` and does NOT use EAS or require an Expo account.

### 2. Watch the build
Go to your repo → **Actions** tab → "Build Android APK" starts automatically after a commit to `main` (or click **Run workflow** manually).
Takes ~10–15 minutes.

### 3. Download the APK
Click the finished run → scroll to **Artifacts** → download **netflixy-release-apk** → extract → you get `app-release.apk`.

### 4. Install on Android
- Send the APK to your phone (email, Google Drive, USB, etc.)
- Open it → allow "Install from unknown sources" when prompted → install

**Note:** This is a release build with the JS bundle embedded directly in the APK, so it works standalone with no dev server needed. If the app ever hangs forever on a black splash screen, that means a debug build got installed instead — make sure the workflow ran `assembleRelease`, not `assembleDebug`.

---

## How it works
1. Open the app → paste your Netflixy API URL
2. Tap **Connect** → fetches your Netflix cookies from `/api/access`
3. Tap **Watch Netflix** → injects ALL cookies natively into Android's WebView cookie store (including HttpOnly ones like `NetflixId`) → Netflix loads authenticated

## API format expected
`GET https://your-api.com/api/access` must return:
```json
{ "found": true, "cookieValue": "# Netscape HTTP Cookie File\n..." }
```
Cookies should be in Netscape tab-separated format. Lines starting with `#HttpOnly_` are handled correctly.
