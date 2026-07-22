/**
 * retryBuild.js — Orchestrateur principal du build Android avec auto-correction IA
 *
 * Processus :
 *   1. Lance la compilation Gradle
 *   2. En cas d'échec, analyse les logs et appelle l'IA pour corriger
 *   3. Relance la compilation (max N tentatives)
 *   4. Génère un résumé JSON et publie l'APK en artefact
 *
 * Usage : node ci/retryBuild.js
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const { spawn }      = require('child_process');
const config         = require('./config');
const { analyzeLogs, analyzeLogFile, formatReport } = require('./analyzeLogs');
const { fixProject } = require('./fixProject');

// ── Initialisation ────────────────────────────────────────────────────────────

config.validate();

if (!fs.existsSync(config.LOGS_DIR)) {
  fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

const log = {
  info:    (...a) => console.log('ℹ️ ', ...a),
  success: (...a) => console.log('✅', ...a),
  error:   (...a) => console.error('❌', ...a),
  warn:    (...a) => console.warn('⚠️ ', ...a),
  section: (t)   => console.log(`\n${'═'.repeat(60)}\n  ${t}\n${'═'.repeat(60)}`),
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function findApk(buildType) {
  const base = path.join(config.ANDROID_DIR, 'app', 'build', 'outputs', 'apk', buildType);
  if (!fs.existsSync(base)) return null;

  const apks = fs.readdirSync(base).filter(f => f.endsWith('.apk'));
  return apks.length > 0 ? path.join(base, apks[0]) : null;
}

// ── Compilation Gradle ────────────────────────────────────────────────────────

/**
 * Lance une compilation Gradle et capture la sortie complète.
 *
 * @param {string}   buildType   - 'debug' ou 'release'
 * @param {string}   logFilePath - Fichier où écrire les logs
 * @param {number}   attemptNum  - Numéro de tentative
 * @returns {Promise<{exitCode: number, duration: number, logContent: string}>}
 */
function runGradle(buildType, logFilePath, attemptNum) {
  return new Promise((resolve) => {
    const taskName = `assemble${buildType.charAt(0).toUpperCase()}${buildType.slice(1)}`;
    const args     = [taskName, ...config.BUILD.gradleArgs];

    log.section(`Compilation Gradle — Tentative ${attemptNum}/${config.BUILD.maxAttempts}`);
    log.info(`Tâche       : ./gradlew ${taskName}`);
    log.info(`Build type  : ${buildType}`);
    log.info(`Répertoire  : ${config.ANDROID_DIR}`);
    log.info(`Heure       : ${timestamp()}`);
    console.log('');

    const logStream  = fs.createWriteStream(logFilePath, { flags: 'w' });
    const logChunks  = [];
    const startTime  = Date.now();

    const gradlew = spawn('./gradlew', args, {
      cwd:   config.ANDROID_DIR,
      shell: false,
      env:   {
        ...process.env,
        JAVA_HOME:    process.env.JAVA_HOME || '',
        ANDROID_HOME: config.ANDROID_DIR.replace('/android', ''),
        GRADLE_OPTS:  process.env.GRADLE_OPTS || '-Xmx3g',
      },
    });

    function handleData(data) {
      const text = data.toString();
      process.stdout.write(text);      // Afficher en live
      logStream.write(text);           // Écrire dans le fichier
      logChunks.push(text);            // Garder en mémoire
    }

    gradlew.stdout.on('data', handleData);
    gradlew.stderr.on('data', handleData);

    // Timeout automatique
    const timer = setTimeout(() => {
      log.error(`Timeout Gradle (${formatDuration(config.BUILD.gradleTimeoutMs)})`);
      gradlew.kill('SIGTERM');
      setTimeout(() => gradlew.kill('SIGKILL'), 5000);
    }, config.BUILD.gradleTimeoutMs);

    gradlew.on('close', (exitCode) => {
      clearTimeout(timer);
      logStream.end();

      const duration    = Date.now() - startTime;
      const logContent  = logChunks.join('');

      if (exitCode === 0) {
        log.success(`Compilation réussie en ${formatDuration(duration)}`);
      } else {
        log.error(`Compilation échouée (code ${exitCode}) en ${formatDuration(duration)}`);
      }

      resolve({ exitCode: exitCode ?? 1, duration, logContent });
    });

    gradlew.on('error', (err) => {
      clearTimeout(timer);
      logStream.end();
      log.error(`Impossible de lancer Gradle : ${err.message}`);
      resolve({ exitCode: 1, duration: Date.now() - startTime, logContent: err.message });
    });
  });
}

// ── Boucle principale ─────────────────────────────────────────────────────────

async function main() {
  const globalStart = Date.now();
  const buildType   = config.BUILD.type;
  const maxAttempts = config.BUILD.maxAttempts;

  const summary = {
    success:       false,
    attempts:      0,
    maxAttempts,
    totalDuration: 0,
    apkPath:       null,
    fixes:         [],
    buildType,
    timestamp:     new Date().toISOString(),
  };

  log.section('GitPush — Build Android avec Auto-Correction IA');
  log.info(`Build type : ${buildType}`);
  log.info(`Max tentatives : ${maxAttempts}`);
  log.info(`Modèle IA : ${config.AI.model}`);
  log.info(`IA activée : ${config.AI.apiKey ? 'OUI' : 'NON (GEMINI_API_KEY manquante)'}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    summary.attempts = attempt;

    const logFile = path.join(config.LOGS_DIR, `build-attempt-${attempt}.log`);

    // ── Compilation ────────────────────────────────────────────────────────
    const { exitCode, duration, logContent } = await runGradle(buildType, logFile, attempt);

    if (exitCode === 0) {
      // ── Succès ──────────────────────────────────────────────────────────
      const apkPath = findApk(buildType);
      summary.success       = true;
      summary.apkPath       = apkPath;
      summary.totalDuration = Math.round((Date.now() - globalStart) / 1000);

      log.section('🎉 BUILD RÉUSSI');
      if (apkPath) {
        const sizeKb = Math.round(fs.statSync(apkPath).size / 1024);
        log.success(`APK : ${apkPath}`);
        log.success(`Taille : ${sizeKb} KB (${Math.round(sizeKb / 1024 * 10) / 10} MB)`);
      }
      log.info(`Tentatives : ${attempt}/${maxAttempts}`);
      log.info(`Durée totale : ${formatDuration(Date.now() - globalStart)}`);

      saveSummary(summary);
      process.exit(0);
    }

    // ── Échec — analyse et correction ──────────────────────────────────────
    if (attempt === maxAttempts) break; // Plus de tentatives disponibles

    log.section(`Analyse des erreurs — Tentative ${attempt}/${maxAttempts}`);

    const analysisResult = analyzeLogs(logContent);
    console.log(formatReport(analysisResult));

    // Sauvegarde de l'analyse
    const analysisFile = path.join(config.LOGS_DIR, `analysis-attempt-${attempt}.json`);
    fs.writeFileSync(analysisFile, JSON.stringify(analysisResult, null, 2), 'utf8');

    if (analysisResult.errors.length === 0) {
      log.warn('Aucune erreur identifiable dans les logs. Nouvelle tentative sans correction.');
      continue;
    }

    // ── Correction IA ──────────────────────────────────────────────────────
    let fixResult = { success: false, explanation: 'IA non disponible', filesChanged: [], packagesInstalled: [] };

    if (config.AI.apiKey) {
      try {
        fixResult = await fixProject(analysisResult, attempt);
        summary.fixes.push({
          attempt,
          explanation:      fixResult.explanation,
          filesChanged:     fixResult.filesChanged,
          packagesInstalled: fixResult.packagesInstalled,
        });

        const fixFile = path.join(config.LOGS_DIR, `fix-attempt-${attempt}.json`);
        fs.writeFileSync(fixFile, JSON.stringify(fixResult, null, 2), 'utf8');
      } catch (err) {
        log.error(`Erreur lors de la correction IA : ${err.message}`);
      }
    } else {
      log.warn('GEMINI_API_KEY non définie — compilation relancée sans correction.');
    }

    log.info(`\nRelance de la compilation dans 3 secondes...`);
    await new Promise(r => setTimeout(r, 3_000));
  }

  // ── Échec final ───────────────────────────────────────────────────────────
  summary.success       = false;
  summary.totalDuration = Math.round((Date.now() - globalStart) / 1000);

  log.section('❌ BUILD ÉCHOUÉ');
  log.error(`Le build a échoué après ${summary.attempts} tentative(s).`);
  log.info(`Durée totale : ${formatDuration(Date.now() - globalStart)}`);
  log.info(`Logs disponibles dans : ${config.LOGS_DIR}`);

  saveSummary(summary);

  // Afficher la dernière erreur pour diagnostic
  const lastLog = path.join(config.LOGS_DIR, `build-attempt-${summary.attempts}.log`);
  if (fs.existsSync(lastLog)) {
    const lastAnalysis = analyzeLogs(fs.readFileSync(lastLog, 'utf8'));
    if (lastAnalysis.errors.length > 0) {
      console.log('\n📋 Dernières erreurs :\n');
      lastAnalysis.errors.slice(0, 5).forEach(e => {
        console.log(`  [${e.type}] ${e.message}`);
      });
    }
  }

  process.exit(1);
}

// ── Sauvegarde du résumé ──────────────────────────────────────────────────────

function saveSummary(summary) {
  const summaryPath = path.join(config.LOGS_DIR, 'build-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  log.info(`Résumé sauvegardé : ${summaryPath}`);
}

// ── Gestion des erreurs non capturées ─────────────────────────────────────────

process.on('uncaughtException', (err) => {
  log.error(`Erreur non gérée : ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error(`Promesse rejetée non gérée : ${reason}`);
  process.exit(1);
});

// ── Lancement ─────────────────────────────────────────────────────────────────

main().catch(err => {
  log.error(`Erreur fatale : ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
