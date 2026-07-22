/**
 * analyzeLogs.js — Analyse les logs de compilation Android
 *
 * Extrait les erreurs Gradle, Metro, React Native, Expo, npm et Kotlin
 * pour les envoyer à l'IA sous forme structurée.
 *
 * @module analyzeLogs
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Types d'erreurs connus ────────────────────────────────────────────────────

/**
 * @typedef {Object} BuildError
 * @property {string}   type        - Catégorie de l'erreur (gradle|metro|expo|npm|syntax|dependency|kotlin|rn)
 * @property {string}   message     - Message d'erreur brut
 * @property {string}   [file]      - Fichier concerné si détectable
 * @property {number}   [line]      - Numéro de ligne si disponible
 * @property {string}   [context]   - Lignes autour de l'erreur pour le contexte
 * @property {string}   severity    - 'error' | 'warning' | 'fatal'
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {BuildError[]} errors          - Liste des erreurs détectées
 * @property {string[]}     affectedFiles   - Fichiers sources impliqués
 * @property {string[]}     missingPackages - Paquets npm manquants à installer
 * @property {string[]}     errorTypes      - Types d'erreurs uniques détectés
 * @property {string}       summary         - Résumé en une ligne
 * @property {boolean}      hasFatalError   - Y a-t-il une erreur bloquante ?
 */

// ── Patterns de détection ─────────────────────────────────────────────────────

const ERROR_PATTERNS = [
  // ── Gradle / Java ────────────────────────────────────────────────────────────
  {
    type: 'gradle',
    severity: 'error',
    regex: /error:\s+(.+)\s+at\s+(.+):(\d+)/i,
    extract: m => ({ message: m[1], file: m[2], line: parseInt(m[3]) }),
  },
  {
    type: 'gradle',
    severity: 'error',
    regex: /^(.+\.(?:java|kt)):(\d+):\s+error:\s+(.+)$/m,
    extract: m => ({ file: m[1], line: parseInt(m[2]), message: m[3] }),
  },
  {
    type: 'gradle',
    severity: 'error',
    regex: /FAILURE:\s+Build failed with an exception/i,
    extract: () => ({ message: 'Gradle build failed (see details above)' }),
  },
  {
    type: 'gradle',
    severity: 'fatal',
    regex: /FATAL EXCEPTION/i,
    extract: m => ({ message: m[0] }),
  },
  {
    type: 'gradle',
    severity: 'error',
    regex: /Execution failed for task '(.+)'/,
    extract: m => ({ message: `Tâche Gradle échouée : ${m[1]}` }),
  },
  {
    type: 'gradle',
    severity: 'error',
    regex: /Could not resolve (.+)\./,
    extract: m => ({ message: `Dépendance Gradle introuvable : ${m[1]}` }),
  },

  // ── Kotlin ───────────────────────────────────────────────────────────────────
  {
    type: 'kotlin',
    severity: 'error',
    regex: /^e:\s+(.+\.kt):\s*\((\d+),\s*(\d+)\):\s+(.+)$/m,
    extract: m => ({ file: m[1], line: parseInt(m[2]), message: m[4] }),
  },
  {
    type: 'kotlin',
    severity: 'error',
    regex: /error: unresolved reference:\s+(.+)/,
    extract: m => ({ message: `Référence Kotlin non résolue : ${m[1]}` }),
  },
  {
    type: 'kotlin',
    severity: 'error',
    regex: /error: type mismatch:\s+(.+)/,
    extract: m => ({ message: `Type Kotlin incompatible : ${m[1]}` }),
  },

  // ── Metro Bundler ─────────────────────────────────────────────────────────────
  {
    type: 'metro',
    severity: 'error',
    regex: /Module not found: Error: Can't resolve '(.+)' in '(.+)'/,
    extract: m => ({ message: `Module Metro introuvable : ${m[1]}`, file: m[2] }),
  },
  {
    type: 'metro',
    severity: 'error',
    regex: /Unable to resolve module (.+?) from (.+?):/,
    extract: m => ({ message: `Impossible de résoudre : ${m[1]}`, file: m[2] }),
  },
  {
    type: 'metro',
    severity: 'error',
    regex: /SyntaxError: (.+) \((\d+):(\d+)\)/,
    extract: m => ({ message: `Erreur de syntaxe Metro : ${m[1]}`, line: parseInt(m[2]) }),
  },
  {
    type: 'metro',
    severity: 'error',
    regex: /Error: ENOENT: no such file or directory,? (.+)/,
    extract: m => ({ message: `Fichier introuvable : ${m[1]}` }),
  },

  // ── React Native ──────────────────────────────────────────────────────────────
  {
    type: 'rn',
    severity: 'error',
    regex: /null is not an object \(evaluating '(.+)'\)/,
    extract: m => ({ message: `Accès null : ${m[1]}` }),
  },
  {
    type: 'rn',
    severity: 'error',
    regex: /Native module cannot be null/i,
    extract: m => ({ message: m[0] }),
  },
  {
    type: 'rn',
    severity: 'error',
    regex: /TurboModule system is not enabled/i,
    extract: m => ({ message: m[0] }),
  },

  // ── Expo ──────────────────────────────────────────────────────────────────────
  {
    type: 'expo',
    severity: 'error',
    regex: /CommandError: (.+)/,
    extract: m => ({ message: `Erreur Expo CLI : ${m[1]}` }),
  },
  {
    type: 'expo',
    severity: 'error',
    regex: /PluginError: (.+)/,
    extract: m => ({ message: `Erreur plugin Expo : ${m[1]}` }),
  },
  {
    type: 'expo',
    severity: 'error',
    regex: /Error running 'prebuild'/i,
    extract: m => ({ message: 'Échec expo prebuild' }),
  },

  // ── npm / pnpm ────────────────────────────────────────────────────────────────
  {
    type: 'npm',
    severity: 'error',
    regex: /npm ERR! (.+)/,
    extract: m => ({ message: `npm error : ${m[1]}` }),
  },
  {
    type: 'npm',
    severity: 'error',
    regex: /ENOTFOUND|ETIMEDOUT|ECONNREFUSED/,
    extract: m => ({ message: `Erreur réseau npm : ${m[0]}` }),
  },

  // ── Dépendances manquantes ────────────────────────────────────────────────────
  {
    type: 'dependency',
    severity: 'error',
    regex: /Cannot find module '(.+?)'/,
    extract: m => ({ message: `Module Node.js introuvable : ${m[1]}`, missingPackage: m[1] }),
  },
  {
    type: 'dependency',
    severity: 'error',
    regex: /Module '(.+?)' not found/,
    extract: m => ({ message: `Module manquant : ${m[1]}`, missingPackage: m[1] }),
  },
  {
    type: 'dependency',
    severity: 'error',
    regex: /error: package (.+?) does not exist/,
    extract: m => ({ message: `Package Java manquant : ${m[1]}` }),
  },

  // ── Syntaxe JS/TS ─────────────────────────────────────────────────────────────
  {
    type: 'syntax',
    severity: 'error',
    regex: /SyntaxError: Unexpected token (.+)/,
    extract: m => ({ message: `Erreur de syntaxe : token inattendu ${m[1]}` }),
  },
  {
    type: 'syntax',
    severity: 'error',
    regex: /SyntaxError: (.+)/,
    extract: m => ({ message: `Erreur de syntaxe : ${m[1]}` }),
  },
  {
    type: 'syntax',
    severity: 'error',
    regex: /Unexpected end of JSON input/,
    extract: m => ({ message: 'JSON malformé : fin de fichier inattendue' }),
  },
];

// ── Patterns pour détecter les fichiers sources ───────────────────────────────

const FILE_PATTERNS = [
  /(?:at|in|from)\s+([/\w.-]+\.(?:js|jsx|ts|tsx|java|kt|gradle))/g,
  /([/\w.-]+\.(?:js|jsx|ts|tsx|java|kt|gradle))(?::\d+)?/g,
];

// ── Patterns pour les paquets npm manquants ───────────────────────────────────

const MISSING_PKG_PATTERNS = [
  /Cannot find module '(@?[\w/-]+)'/,
  /Module not found: Error: Can't resolve '(@?[\w/-]+)'/,
  /Unable to resolve module (@?[\w/-]+)/,
];

// ── Fonction principale ───────────────────────────────────────────────────────

/**
 * Analyse les logs de build et retourne une structure exploitable par l'IA.
 *
 * @param {string} logContent - Contenu brut des logs de compilation
 * @returns {AnalysisResult}
 */
function analyzeLogs(logContent) {
  if (!logContent || typeof logContent !== 'string') {
    return _emptyResult('Aucun log fourni');
  }

  const lines  = logContent.split('\n');
  const errors = [];
  const seenMessages = new Set();

  // ── Analyse ligne par ligne ───────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern.regex);
      if (!match) continue;

      const extracted = pattern.extract(match);
      const message   = extracted.message || line.trim();

      // Déduplique les erreurs identiques
      if (seenMessages.has(message)) continue;
      seenMessages.add(message);

      // Contexte : 3 lignes avant/après
      const contextLines = lines
        .slice(Math.max(0, i - 3), Math.min(lines.length, i + 4))
        .join('\n');

      errors.push({
        type:     pattern.type,
        severity: pattern.severity,
        message,
        file:     extracted.file    || null,
        line:     extracted.line    || null,
        context:  contextLines,
        missingPackage: extracted.missingPackage || null,
      });

      break; // Un seul pattern par ligne
    }
  }

  // ── Extraction des fichiers affectés ──────────────────────────────────────
  const affectedFilesSet = new Set();
  for (const err of errors) {
    if (err.file) {
      // Normalise le chemin
      const normalized = err.file
        .replace(/\\/g, '/')
        .replace(/^.*\/(?:app\/|android\/|src\/)/, '');
      affectedFilesSet.add(normalized);
    }
  }

  // Extraire les fichiers depuis les messages également
  for (const err of errors) {
    for (const pattern of FILE_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(err.message)) !== null) {
        const f = m[1].replace(/\\/g, '/');
        if (!f.includes('node_modules') && !f.includes('.gradle')) {
          affectedFilesSet.add(f);
        }
      }
    }
  }

  // ── Paquets npm manquants ─────────────────────────────────────────────────
  const missingPackages = [];
  for (const err of errors) {
    if (err.missingPackage) {
      const pkg = err.missingPackage
        .replace(/\/.*$/, '') // garder seulement le scope + nom principal
        .trim();
      if (pkg && !pkg.startsWith('.') && !missingPackages.includes(pkg)) {
        missingPackages.push(pkg);
      }
    }
  }

  // Scan global pour les paquets manquants
  for (const pattern of MISSING_PKG_PATTERNS) {
    const gMatch = logContent.match(new RegExp(pattern.source, 'g'));
    if (gMatch) {
      for (const m of gMatch) {
        const sub = m.match(pattern);
        if (sub && sub[1] && !sub[1].startsWith('.')) {
          const pkg = sub[1].split('/')[0];
          if (!missingPackages.includes(pkg)) {
            missingPackages.push(pkg);
          }
        }
      }
    }
  }

  // ── Types uniques ──────────────────────────────────────────────────────────
  const errorTypes = [...new Set(errors.map(e => e.type))];

  // ── Résumé ────────────────────────────────────────────────────────────────
  const fatalErrors = errors.filter(e => e.severity === 'fatal');
  const regularErrors = errors.filter(e => e.severity === 'error');
  const summary = [
    `${errors.length} erreur(s) détectée(s)`,
    errorTypes.length ? `[${errorTypes.join(', ')}]` : '',
    fatalErrors.length ? `⚠️ ${fatalErrors.length} erreur(s) fatale(s)` : '',
  ].filter(Boolean).join(' ');

  return {
    errors,
    affectedFiles: [...affectedFilesSet],
    missingPackages,
    errorTypes,
    summary,
    hasFatalError: fatalErrors.length > 0,
  };
}

/**
 * Lit un fichier de log et retourne l'analyse.
 *
 * @param {string} logFilePath - Chemin vers le fichier de log
 * @returns {AnalysisResult}
 */
function analyzeLogFile(logFilePath) {
  if (!fs.existsSync(logFilePath)) {
    return _emptyResult(`Fichier de log introuvable : ${logFilePath}`);
  }
  const content = fs.readFileSync(logFilePath, 'utf8');
  return analyzeLogs(content);
}

/**
 * Génère un rapport JSON lisible pour les logs.
 *
 * @param {AnalysisResult} result
 * @returns {string}
 */
function formatReport(result) {
  const lines = [
    '═══════════════════════════════════════════════',
    `  🔍 Analyse des logs — ${result.summary}`,
    '═══════════════════════════════════════════════',
    '',
  ];

  if (result.errors.length === 0) {
    lines.push('  ✅ Aucune erreur détectée dans les logs.');
    return lines.join('\n');
  }

  // Grouper par type
  const byType = {};
  for (const err of result.errors) {
    if (!byType[err.type]) byType[err.type] = [];
    byType[err.type].push(err);
  }

  for (const [type, errs] of Object.entries(byType)) {
    lines.push(`  📌 ${type.toUpperCase()} (${errs.length} erreur(s))`);
    for (const err of errs.slice(0, 5)) { // max 5 par type
      lines.push(`    • [${err.severity}] ${err.message}`);
      if (err.file) lines.push(`      Fichier : ${err.file}${err.line ? `:${err.line}` : ''}`);
    }
    lines.push('');
  }

  if (result.missingPackages.length > 0) {
    lines.push(`  📦 Paquets manquants : ${result.missingPackages.join(', ')}`);
    lines.push('');
  }

  if (result.affectedFiles.length > 0) {
    lines.push(`  📄 Fichiers concernés :`);
    result.affectedFiles.slice(0, 10).forEach(f => lines.push(`    - ${f}`));
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════');
  return lines.join('\n');
}

// ── Utilitaires privés ────────────────────────────────────────────────────────

function _emptyResult(summary) {
  return {
    errors: [],
    affectedFiles: [],
    missingPackages: [],
    errorTypes: [],
    summary,
    hasFatalError: false,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { analyzeLogs, analyzeLogFile, formatReport };

// ── CLI direct ────────────────────────────────────────────────────────────────
if (require.main === module) {
  const logFile = process.argv[2];
  if (!logFile) {
    console.error('Usage : node analyzeLogs.js <chemin-du-log>');
    process.exit(1);
  }
  const result = analyzeLogFile(logFile);
  console.log(formatReport(result));
  console.log('\nJSON :', JSON.stringify(result, null, 2));
}
