/**
 * prepare.js — Prépare le projet pour la compilation en CI
 *
 * Ce script est exécuté AVANT npm install pour :
 *   1. Supprimer les dépendances @workspace/* (spécifiques au monorepo Replit)
 *   2. Remplacer les références workspace: par des versions réelles si possible
 *   3. S'assurer que le package.json est compatible avec un environnement CI standard
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT         = path.resolve(__dirname, '..');
const PKG_PATH     = path.join(ROOT, 'package.json');
const BACKUP_PATH  = path.join(ROOT, 'package.json.ci.bak');

// ── Lecture du package.json ───────────────────────────────────────────────────
if (!fs.existsSync(PKG_PATH)) {
  console.error('❌ package.json introuvable à la racine du projet.');
  process.exit(1);
}

const raw = fs.readFileSync(PKG_PATH, 'utf8');
const pkg = JSON.parse(raw);

// Sauvegarde avant modification
fs.writeFileSync(BACKUP_PATH, raw, 'utf8');
console.log(`📦 Sauvegarde du package.json original → ${BACKUP_PATH}`);

// ── Suppression des dépendances @workspace/* ─────────────────────────────────
let removed = [];

function cleanDeps(depObj, label) {
  if (!depObj) return depObj;
  const cleaned = {};
  for (const [name, version] of Object.entries(depObj)) {
    if (name.startsWith('@workspace/') || String(version).startsWith('workspace:')) {
      removed.push(`${label}: ${name}@${version}`);
    } else {
      cleaned[name] = version;
    }
  }
  return cleaned;
}

pkg.dependencies    = cleanDeps(pkg.dependencies,    'dep');
pkg.devDependencies = cleanDeps(pkg.devDependencies, 'devDep');
pkg.peerDependencies = cleanDeps(pkg.peerDependencies, 'peerDep');

// Suppression des champs spécifiques aux workspaces
delete pkg.workspaces;

// Force le nom à ne pas avoir de @ pour éviter des problèmes en CI
if (pkg.name && pkg.name.startsWith('@workspace/')) {
  pkg.name = pkg.name.replace('@workspace/', '');
}

// ── Écriture du package.json modifié ─────────────────────────────────────────
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// ── Rapport ───────────────────────────────────────────────────────────────────
if (removed.length > 0) {
  console.log(`\n🧹 Dépendances @workspace/* supprimées (${removed.length}) :`);
  removed.forEach(r => console.log(`   - ${r}`));
} else {
  console.log('✅ Aucune dépendance @workspace/* détectée.');
}

console.log('\n✅ package.json prêt pour la CI.');
