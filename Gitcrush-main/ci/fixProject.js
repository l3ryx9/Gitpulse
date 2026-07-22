/**
 * fixProject.js — Correction automatique du projet via Gemini AI
 *
 * Envoie les erreurs de build à Gemini, reçoit des corrections sous forme de JSON,
 * et applique les modifications de fichiers + installations de paquets.
 *
 * @module fixProject
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config        = require('./config');
const { formatReport } = require('./analyzeLogs');

// ── Constantes ────────────────────────────────────────────────────────────────

/** Taille max d'un fichier source envoyé à l'IA (évite les prompts trop longs) */
const MAX_FILE_SIZE_BYTES = 30_000;

/** Nombre max de fichiers sources lus pour le contexte */
const MAX_FILES_IN_PROMPT = 8;

/** Extensions de fichiers que l'IA peut modifier */
const MODIFIABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx',
  '.json',
  '.gradle', '.properties',
  '.java', '.kt',
  '.pro', '.xml',
]);

// ── Prompt système ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
Tu es un expert en développement React Native / Expo / Android.
Ta tâche est d'analyser des erreurs de compilation et de proposer des corrections précises.

RÈGLES STRICTES :
1. Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après.
2. Ne modifie QUE les fichiers qui contiennent des erreurs.
3. Fournis le CONTENU COMPLET de chaque fichier modifié (pas de diff partiel).
4. Si une dépendance npm manque, liste-la dans "packages".
5. N'invente pas de fichiers — modifie uniquement ceux qui t'ont été fournis.
6. Préfère des corrections minimales et ciblées.
7. Si tu ne peux pas corriger l'erreur, explique pourquoi dans "explanation".

FORMAT DE RÉPONSE JSON ATTENDU :
{
  "explanation": "Explication claire de la cause et de la correction (max 300 chars)",
  "changes": [
    {
      "file": "chemin/relatif/du/fichier.ts",
      "content": "... contenu complet du fichier corrigé ..."
    }
  ],
  "packages": ["nom-paquet@version"],
  "confidence": 0.85
}
`.trim();

// ── Fonction principale ───────────────────────────────────────────────────────

/**
 * Analyse les erreurs de build et applique des corrections IA.
 *
 * @param {import('./analyzeLogs').AnalysisResult} analysisResult
 * @param {number} attemptNumber - Numéro de tentative (1-5)
 * @returns {Promise<{success: boolean, explanation: string, filesChanged: string[], packagesInstalled: string[]}>}
 */
async function fixProject(analysisResult, attemptNumber = 1) {
  console.log(`\n🤖 Correction IA — tentative ${attemptNumber}/${config.BUILD.maxAttempts}`);
  console.log(`   Erreurs détectées : ${analysisResult.errors.length}`);
  console.log(`   Types : ${analysisResult.errorTypes.join(', ') || 'inconnus'}`);

  if (!config.AI.apiKey) {
    console.warn('⚠️  GEMINI_API_KEY non définie — correction IA ignorée.');
    return { success: false, explanation: 'Clé API Gemini manquante', filesChanged: [], packagesInstalled: [] };
  }

  if (analysisResult.errors.length === 0) {
    console.log('ℹ️  Aucune erreur à corriger.');
    return { success: true, explanation: 'Aucune erreur', filesChanged: [], packagesInstalled: [] };
  }

  // ── 1. Installer les paquets npm manquants d'abord ───────────────────────
  let packagesInstalled = [];
  if (analysisResult.missingPackages.length > 0) {
    packagesInstalled = await installMissingPackages(analysisResult.missingPackages);
  }

  // ── 2. Lire les fichiers sources concernés ───────────────────────────────
  const sourceFiles = await readAffectedFiles(analysisResult.affectedFiles);

  // ── 3. Construire le prompt ──────────────────────────────────────────────
  const prompt = buildPrompt(analysisResult, sourceFiles, attemptNumber);
  console.log(`   Prompt : ~${Math.round(prompt.length / 4)} tokens estimés`);

  // ── 4. Appel Gemini ──────────────────────────────────────────────────────
  let geminiResponse;
  try {
    geminiResponse = await callGemini(prompt);
  } catch (err) {
    console.error(`❌ Erreur Gemini : ${err.message}`);
    return { success: false, explanation: `Erreur API Gemini : ${err.message}`, filesChanged: [], packagesInstalled };
  }

  // ── 5. Parser la réponse ─────────────────────────────────────────────────
  let parsed;
  try {
    parsed = parseGeminiResponse(geminiResponse);
  } catch (err) {
    console.error(`❌ Réponse Gemini non parsable : ${err.message}`);
    console.error('Réponse brute :', geminiResponse.slice(0, 500));
    return { success: false, explanation: 'Réponse IA invalide', filesChanged: [], packagesInstalled };
  }

  console.log(`\n💡 Explication IA : ${parsed.explanation}`);
  console.log(`   Confiance : ${Math.round((parsed.confidence || 0.5) * 100)}%`);

  // ── 6. Appliquer les modifications de fichiers ───────────────────────────
  const filesChanged = await applyFileChanges(parsed.changes || []);

  // ── 7. Installer les paquets suggérés par l'IA ───────────────────────────
  if (parsed.packages && parsed.packages.length > 0) {
    const aiPackages = await installMissingPackages(parsed.packages);
    packagesInstalled.push(...aiPackages);
  }

  // ── 8. Rapport ───────────────────────────────────────────────────────────
  console.log(`\n✅ Correction appliquée :`);
  if (filesChanged.length > 0)    console.log(`   Fichiers modifiés : ${filesChanged.join(', ')}`);
  if (packagesInstalled.length > 0) console.log(`   Paquets installés : ${packagesInstalled.join(', ')}`);

  return {
    success:          filesChanged.length > 0 || packagesInstalled.length > 0,
    explanation:      parsed.explanation,
    filesChanged,
    packagesInstalled,
  };
}

// ── Construction du prompt ────────────────────────────────────────────────────

function buildPrompt(analysisResult, sourceFiles, attemptNumber) {
  const errorBlock = analysisResult.errors
    .slice(0, 20) // max 20 erreurs
    .map((e, i) => [
      `[Erreur ${i + 1}] Type: ${e.type} | Sévérité: ${e.severity}`,
      `Message: ${e.message}`,
      e.file ? `Fichier: ${e.file}${e.line ? `:${e.line}` : ''}` : '',
      e.context ? `Contexte:\n${e.context}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n---\n');

  const filesBlock = sourceFiles
    .map(f => `=== FICHIER: ${f.relativePath} ===\n${f.content}`)
    .join('\n\n');

  return [
    `TENTATIVE ${attemptNumber}/${config.BUILD.maxAttempts}`,
    '',
    '## ERREURS DE BUILD',
    errorBlock,
    '',
    sourceFiles.length > 0 ? '## FICHIERS SOURCES CONCERNÉS' : '',
    sourceFiles.length > 0 ? filesBlock : '',
    '',
    `## PAQUETS MANQUANTS DÉTECTÉS`,
    analysisResult.missingPackages.length > 0
      ? analysisResult.missingPackages.join(', ')
      : '(aucun détecté automatiquement)',
    '',
    '## INSTRUCTION',
    'Analyse les erreurs ci-dessus et fournis les corrections nécessaires en JSON.',
    'Corrige UNIQUEMENT ce qui est cassé. Ne réécris pas des fichiers entiers si seules quelques lignes sont en cause.',
  ].filter(s => s !== null).join('\n');
}

// ── Appel Gemini ──────────────────────────────────────────────────────────────

async function callGemini(prompt) {
  const genAI = new GoogleGenerativeAI(config.AI.apiKey);
  const model = genAI.getGenerativeModel({
    model: config.AI.model,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature:     config.AI.temperature,
      maxOutputTokens: config.AI.maxOutputTokens,
      responseMimeType: 'application/json',
    },
  });

  // Timeout via Promise.race
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout Gemini (${config.AI.requestTimeoutMs}ms)`)),
      config.AI.requestTimeoutMs)
  );

  const result = await Promise.race([
    model.generateContent(prompt),
    timeoutPromise,
  ]);

  return result.response.text();
}

// ── Parsing de la réponse ─────────────────────────────────────────────────────

function parseGeminiResponse(raw) {
  // Nettoyer les balises markdown éventuelles
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  // Validation minimale
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('La réponse n\'est pas un objet JSON');
  }

  return {
    explanation: parsed.explanation || 'Correction appliquée par l\'IA',
    changes:     Array.isArray(parsed.changes) ? parsed.changes : [],
    packages:    Array.isArray(parsed.packages) ? parsed.packages : [],
    confidence:  typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };
}

// ── Application des modifications ─────────────────────────────────────────────

async function applyFileChanges(changes) {
  const filesChanged = [];

  for (const change of changes) {
    if (!change.file || typeof change.content !== 'string') {
      console.warn(`⚠️  Modification ignorée (format invalide) :`, change);
      continue;
    }

    const filePath = path.resolve(config.PROJECT_ROOT, change.file);

    // Sécurité : ne pas modifier des fichiers hors du projet
    if (!filePath.startsWith(config.PROJECT_ROOT)) {
      console.warn(`⚠️  Tentative d'écriture hors du projet ignorée : ${change.file}`);
      continue;
    }

    // Vérifier l'extension
    const ext = path.extname(filePath).toLowerCase();
    if (!MODIFIABLE_EXTENSIONS.has(ext)) {
      console.warn(`⚠️  Extension non autorisée ignorée : ${ext}`);
      continue;
    }

    // Sauvegarde avant modification
    if (fs.existsSync(filePath)) {
      const backupPath = filePath + `.bak.${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);
    }

    // Créer les dossiers parents si nécessaire
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Écrire le fichier corrigé
    fs.writeFileSync(filePath, change.content, 'utf8');
    filesChanged.push(change.file);
    console.log(`   📝 Fichier modifié : ${change.file}`);
  }

  return filesChanged;
}

// ── Installation de paquets ───────────────────────────────────────────────────

async function installMissingPackages(packages) {
  if (!packages || packages.length === 0) return [];

  const installed = [];
  console.log(`\n📦 Installation de ${packages.length} paquet(s) : ${packages.join(', ')}`);

  for (const pkg of packages) {
    // Validation du nom de paquet
    if (!/^[@\w][\w./-]*(@[\w^~.]+)?$/.test(pkg)) {
      console.warn(`⚠️  Nom de paquet suspect ignoré : ${pkg}`);
      continue;
    }

    try {
      execSync(`npm install --legacy-peer-deps ${pkg}`, {
        cwd: config.PROJECT_ROOT,
        stdio: 'pipe',
        timeout: 60_000,
      });
      installed.push(pkg);
      console.log(`   ✅ ${pkg} installé`);
    } catch (err) {
      console.error(`   ❌ Échec installation ${pkg} : ${err.message?.slice(0, 200)}`);
    }
  }

  return installed;
}

// ── Lecture des fichiers sources ──────────────────────────────────────────────

async function readAffectedFiles(affectedFiles) {
  const result = [];
  const seen   = new Set();

  const candidates = [
    ...affectedFiles,
    // Toujours inclure ces fichiers clés
    'app/_layout.tsx',
    'app.json',
    'package.json',
  ];

  for (const relPath of candidates) {
    if (result.length >= MAX_FILES_IN_PROMPT) break;
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const absPath = path.resolve(config.PROJECT_ROOT, relPath);

    // Ignorer les fichiers node_modules, build, etc.
    if (config.EXCLUDED_FILES.some(ex => absPath.includes(ex))) continue;

    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      console.log(`   ⚠️  Fichier trop grand ignoré : ${relPath} (${Math.round(stat.size / 1024)}KB)`);
      continue;
    }

    const ext = path.extname(absPath).toLowerCase();
    if (!config.ANALYZABLE_EXTENSIONS.includes(ext)) continue;

    try {
      const content = fs.readFileSync(absPath, 'utf8');
      result.push({ relativePath: relPath, content });
    } catch {
      // Fichier non lisible, ignoré
    }
  }

  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { fixProject };
