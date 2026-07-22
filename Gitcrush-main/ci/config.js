/**
 * config.js — Configuration centrale du système CI/CD
 *
 * Toutes les valeurs sont surchargeables via variables d'environnement.
 * La clé GEMINI_API_KEY doit être définie en secret GitHub Actions.
 */

'use strict';

const path = require('path');

// ── Racine du projet ──────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR  = path.join(PROJECT_ROOT, 'android');
const CI_DIR       = path.join(PROJECT_ROOT, 'ci');
const LOGS_DIR     = path.join(CI_DIR, 'logs');

// ── Configuration Build ───────────────────────────────────────────────────────
const BUILD = {
  /** Variante Gradle : 'release' pour un APK obfusqué, 'debug' pour les tests */
  type: (process.env.BUILD_TYPE || 'release').toLowerCase(),

  /** Nombre maximum de tentatives avant abandon */
  maxAttempts: parseInt(process.env.MAX_BUILD_ATTEMPTS || '5', 10),

  /** Timeout Gradle en millisecondes (20 min) */
  gradleTimeoutMs: parseInt(process.env.GRADLE_TIMEOUT_MS || String(20 * 60 * 1000), 10),

  /** Options Gradle partagées */
  gradleArgs: [
    '--no-daemon',
    '--warning-mode=none',
    '--stacktrace',
    '-q',
  ],
};

// ── Configuration Gemini AI ───────────────────────────────────────────────────
const AI = {
  /** Clé API Gemini — obligatoire */
  apiKey: process.env.GEMINI_API_KEY || '',

  /**
   * Modèle Gemini à utiliser.
   * Options recommandées :
   *   - gemini-2.0-flash          (rapide, gratuit, suffisant pour corriger du code)
   *   - gemini-1.5-pro            (plus puissant mais plus lent)
   *   - gemini-2.5-pro-preview    (meilleur raisonnement)
   */
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',

  /** Température de génération (0 = déterministe, 1 = créatif) */
  temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.2'),

  /** Nombre de tokens maximum dans la réponse IA */
  maxOutputTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '8192', 10),

  /** Timeout pour la requête Gemini en millisecondes (90 s) */
  requestTimeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || '90000', 10),
};

// ── Fichiers exclus de l'analyse ─────────────────────────────────────────────
const EXCLUDED_FILES = [
  'node_modules',
  '.git',
  'android/build',
  'android/.gradle',
  'android/app/build',
  'ci/logs',
  'ci/node_modules',
  '.expo',
];

// ── Extensions de fichiers analysables ───────────────────────────────────────
const ANALYZABLE_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx',
  '.json',
  '.gradle', '.properties', '.xml',
  '.java', '.kt',
  '.pro',
];

// ── Validation ────────────────────────────────────────────────────────────────
function validate() {
  const warnings = [];
  if (!AI.apiKey) {
    warnings.push(
      '⚠️  GEMINI_API_KEY non définie — la correction automatique par IA sera désactivée.'
    );
  }
  if (!['debug', 'release'].includes(BUILD.type)) {
    throw new Error(`BUILD_TYPE invalide : "${BUILD.type}". Valeurs acceptées : debug, release.`);
  }
  if (BUILD.maxAttempts < 1 || BUILD.maxAttempts > 10) {
    throw new Error(`MAX_BUILD_ATTEMPTS doit être compris entre 1 et 10 (valeur : ${BUILD.maxAttempts}).`);
  }
  warnings.forEach(w => console.warn(w));
}

module.exports = {
  PROJECT_ROOT,
  ANDROID_DIR,
  CI_DIR,
  LOGS_DIR,
  BUILD,
  AI,
  EXCLUDED_FILES,
  ANALYZABLE_EXTENSIONS,
  validate,
};
