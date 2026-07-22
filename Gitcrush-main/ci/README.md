# 🤖 CI — Build Android avec Auto-Correction IA

Système de compilation automatique pour **GitPush** : compile un APK Android via GitHub Actions, détecte les erreurs, les envoie à Gemini AI pour correction, et relance jusqu'à réussite.

---

## Architecture

```
ci/
├── retryBuild.js    # Orchestrateur principal (boucle build → analyse → fix)
├── analyzeLogs.js   # Détection des erreurs Gradle/Metro/Expo/npm/Kotlin
├── fixProject.js    # Correction IA via Gemini API
├── config.js        # Configuration centralisée
├── prepare.js       # Nettoyage du package.json pour CI
└── logs/            # Logs générés à chaque run (auto-créé)
    ├── build-attempt-N.log
    ├── analysis-attempt-N.json
    ├── fix-attempt-N.json
    └── build-summary.json
```

---

## Configuration (GitHub Secrets)

| Secret           | Obligatoire | Description                          |
|------------------|-------------|--------------------------------------|
| `GEMINI_API_KEY` | ✅          | Clé API Google Gemini (obtenir sur [aistudio.google.com](https://aistudio.google.com/app/apikey)) |

### Variables d'environnement optionnelles

| Variable               | Défaut              | Description                          |
|------------------------|---------------------|--------------------------------------|
| `BUILD_TYPE`           | `release`           | `debug` ou `release`                 |
| `MAX_BUILD_ATTEMPTS`   | `5`                 | Nombre max de tentatives (1-10)      |
| `GEMINI_MODEL`         | `gemini-2.0-flash`  | Modèle Gemini à utiliser             |
| `GEMINI_TEMPERATURE`   | `0.2`               | Créativité de l'IA (0 = déterministe)|
| `GRADLE_TIMEOUT_MS`    | `1200000` (20 min)  | Timeout Gradle en ms                 |

---

## Déclenchement

Le workflow se lance automatiquement sur :
- **Push** sur `main` ou `master`
- **Pull Request** vers `main` ou `master`
- **Manuellement** via GitHub Actions → *Run workflow* (avec choix `debug`/`release`)

---

## Processus de build

```
┌─────────────────────────────────────────────────────────┐
│                   retryBuild.js                         │
│                                                         │
│  Tentative 1 ──► Gradle ──► ✅ Succès → Upload APK     │
│                     │                                   │
│                     ▼ ❌ Échec                          │
│              analyzeLogs.js                             │
│         (Gradle/Metro/Kotlin/npm/Expo)                  │
│                     │                                   │
│                     ▼                                   │
│               fixProject.js                             │
│          (Gemini API → JSON → apply)                    │
│                     │                                   │
│                     ▼                                   │
│  Tentative 2 ──► Gradle ──► ✅ ou ❌ → (retry ×5)     │
│                                                         │
│  Après 5 échecs → Sauvegarde logs → Exit 1             │
└─────────────────────────────────────────────────────────┘
```

---

## Erreurs détectées automatiquement

| Catégorie       | Exemples                                                |
|-----------------|---------------------------------------------------------|
| **Gradle**      | `Build failed`, `Could not resolve`, tâche échouée     |
| **Kotlin**      | `unresolved reference`, `type mismatch`                 |
| **Metro**       | `Module not found`, `Unable to resolve module`          |
| **React Native**| `Native module cannot be null`, erreurs JSI             |
| **Expo**        | `CommandError`, `PluginError`, erreurs prebuild         |
| **npm**         | `ERR!`, erreurs réseau, `ENOTFOUND`                    |
| **Syntaxe**     | `SyntaxError`, JSON malformé                            |
| **Dépendances** | `Cannot find module`, imports manquants                 |

---

## Obfuscation ProGuard/R8

Le build **release** active automatiquement :
- **R8** (minification + obfuscation du bytecode Java/Kotlin)
- **Hermes** (compilation JS → bytecode binaire non lisible)
- **Repackaging** des classes dans le namespace `x.*`
- **Suppression** des logs `android.util.Log.d/v/i`
- **Optimisation** en 5 passes

> Le code JavaScript est compilé par Hermes en bytecode — il n'est pas lisible via décompilation.

---

## APK généré

L'APK est disponible dans **GitHub Actions → Artifacts** sous le nom :
```
GitPush-release-{run_number}
```

Ou en local :
```
android/app/build/outputs/apk/release/app-release.apk
```

---

## Lancer localement

```bash
# Prérequis : JDK 17, Android SDK (ANDROID_HOME), Node.js 20

cd ci && npm install
cd ..

export GEMINI_API_KEY="ta-clé-gemini"
export BUILD_TYPE=debug

node ci/retryBuild.js
```
