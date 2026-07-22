import { Feather, Octicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import JSZip from "jszip";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGitHub } from "@/context/GitHubContext";
import { useColors } from "@/hooks/useColors";
import type { GitHubRepo } from "@/context/GitHubContext";

interface SelectedFile {
  name: string;
  uri: string;
  size: number;
  type: string;
}

export default function FilesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, repos, selectedRepo, branches, currentBranch, selectRepo, selectBranch, pushFile, deleteDirectory, deleteBranch, deleteRepo, emptyRepo, getTreePaths, reposLoading, loading } = useGitHub();
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [commitMsg, setCommitMsg] = useState("feat: upload via Gitcrush");
  const [targetPath, setTargetPath] = useState("");
  const [pushing, setPushing] = useState(false);
  const [showRepoList, setShowRepoList] = useState(false);
  const [showBranchList, setShowBranchList] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [deletePath, setDeletePath] = useState("");
  const [deleteMsg, setDeleteMsg] = useState("chore: suppression de répertoire via Gitcrush");
  const [deleting, setDeleting] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);
  const [deletingBranch, setDeletingBranch] = useState(false);
  const [deletingRepo, setDeletingRepo] = useState(false);
  const [emptyingRepo, setEmptyingRepo] = useState(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: "#0d1117", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#3fb950" size="large" />
    </View>
  );

  if (!user) return null;

  const filteredRepos = repos.filter((r) =>
    r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const a = result.assets[0];
      setFile({
        name: a.name,
        uri: a.uri,
        size: a.size ?? 0,
        type: a.mimeType ?? "application/octet-stream",
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      Alert.alert("Erreur", "Impossible de sélectionner le fichier");
    }
  }

  function removeFile() {
    setFile(null);
  }

  function isZipFile(f: SelectedFile) {
    return (
      f.name.toLowerCase().endsWith(".zip") ||
      f.type === "application/zip" ||
      f.type === "application/x-zip-compressed"
    );
  }

  async function readFileAsBase64(uri: string): Promise<string> {
    if (Platform.OS === "web") {
      const resp = await fetch(uri);
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }

  /**
   * Retrouve où pousser un fichier pour qu'il REMPLACE l'ancien dans son répertoire :
   *  1. le même chemin existe déjà → remplacement direct
   *  2. le même chemin relatif existe ailleurs dans l'arborescence → remplacement là-bas
   *  3. un unique fichier porte le même nom → remplacement dans son répertoire
   *  4. aucun ancien fichier → création au chemin d'origine
   * Si plusieurs anciens fichiers correspondent, on renvoie les candidats (ambigu).
   */
  function resolveAgainstTree(
    relPath: string,
    treePaths: string[]
  ): { path: string; replaced: boolean } | { candidates: string[] } {
    if (treePaths.includes(relPath)) return { path: relPath, replaced: true };

    const bySuffix = treePaths.filter((p) => p.endsWith(`/${relPath}`));
    if (bySuffix.length === 1) return { path: bySuffix[0], replaced: true };
    if (bySuffix.length > 1) return { candidates: bySuffix };

    const base = relPath.split("/").pop() as string;
    if (base !== relPath) {
      const byName = treePaths.filter((p) => p === base || p.endsWith(`/${base}`));
      if (byName.length === 1) return { path: byName[0], replaced: true };
      if (byName.length > 1) return { candidates: byName };
    }

    return { path: relPath, replaced: false };
  }

  async function handlePush() {
    if (!selectedRepo) {
      Alert.alert("Erreur", "Sélectionnez un dépôt d'abord");
      return;
    }
    if (!file) {
      Alert.alert("Erreur", "Aucun fichier sélectionné");
      return;
    }
    if (!commitMsg.trim()) {
      Alert.alert("Erreur", "Entrez un message de commit");
      return;
    }

    setPushing(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      const base64 = await readFileAsBase64(file.uri);

      if (isZipFile(file)) {
        // Zip : extraction et push de TOUS les fichiers qu'il contient
        const zip = await JSZip.loadAsync(base64, { base64: true });
        const entries = Object.values(zip.files).filter((e) => !e.dir);

        if (entries.length === 0) {
          setPushing(false);
          setPushProgress(null);
          Alert.alert("Erreur", "Le zip est vide ou illisible");
          return;
        }

        let successCount = 0;
        let replacedCount = 0;
        let createdCount = 0;
        const errors: string[] = [];
        setPushProgress({ done: 0, total: entries.length });

        // Arborescence actuelle du dépôt pour retrouver les anciens emplacements
        const treePaths = targetPath.trim() ? [] : await getTreePaths();

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          try {
            const content = await entry.async("base64");
            const relPath = entry.name.replace(/^\/+/, "");

            let path: string;
            let willReplace = false;
            if (targetPath.trim()) {
              path = `${targetPath.trim().replace(/\/$/, "")}/${relPath}`;
            } else {
              const resolved = resolveAgainstTree(relPath, treePaths);
              if ("candidates" in resolved) {
                const shown = resolved.candidates.slice(0, 3).join(", ");
                const extra = resolved.candidates.length > 3 ? `, … (${resolved.candidates.length})` : "";
                errors.push(`${relPath}: plusieurs emplacements possibles (${shown}${extra}) — précisez le chemin cible`);
                setPushProgress({ done: i + 1, total: entries.length });
                continue;
              }
              path = resolved.path;
              willReplace = resolved.replaced;
            }

            const res = await pushFile(path, content, commitMsg.trim());
            if (res.ok) {
              successCount++;
              if (willReplace) replacedCount++;
              else createdCount++;
              if (!willReplace && !targetPath.trim()) treePaths.push(path);
            } else {
              errors.push(`${relPath}: ${res.error ?? "Erreur inconnue"}`);
            }
          } catch (e) {
            errors.push(`${entry.name}: ${String(e)}`);
          }
          setPushProgress({ done: i + 1, total: entries.length });
        }

        setPushing(false);
        setPushProgress(null);

        if (successCount > 0) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setFile(null);
          Alert.alert(
            "Succès",
            `${successCount}/${entries.length} fichier(s) du zip pushé(s) vers ${selectedRepo.name}/${currentBranch}\n\n${replacedCount} remplacé(s) · ${createdCount} créé(s)`,
            [{ text: "OK" }]
          );
        }
        if (errors.length > 0) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Erreurs", errors.slice(0, 20).join("\n") + (errors.length > 20 ? `\n… et ${errors.length - 20} autre(s)` : ""));
        }
        return;
      }

      // Fichier simple (non zip) : retrouver l'ancien fichier du même nom
      let path: string;
      let statusLine = "";
      if (targetPath.trim()) {
        path = `${targetPath.trim().replace(/\/$/, "")}/${file.name}`;
      } else {
        const treePaths = await getTreePaths();
        const resolved = resolveAgainstTree(file.name, treePaths);
        if ("candidates" in resolved) {
          setPushing(false);
          Alert.alert(
            "Plusieurs emplacements possibles",
            `« ${file.name} » existe à plusieurs endroits dans le dépôt :\n\n${resolved.candidates
              .slice(0, 8)
              .map((c) => `• ${c}`)
              .join("\n")}${resolved.candidates.length > 8 ? `\n… et ${resolved.candidates.length - 8} autre(s)` : ""}\n\nRenseignez le « chemin cible » pour choisir l'emplacement.`
          );
          return;
        }
        path = resolved.path;
        statusLine = resolved.replaced ? `\n\nRemplacé : ${path}` : `\n\nCréé : ${path}`;
      }

      const res = await pushFile(path, base64, commitMsg.trim());
      setPushing(false);

      if (res.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFile(null);
        Alert.alert(
          "Succès",
          `Fichier pushé vers ${selectedRepo.name}/${currentBranch}${statusLine}`,
          [{ text: "OK" }]
        );
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Erreur", res.error ?? "Erreur inconnue");
      }
    } catch (e) {
      setPushing(false);
      setPushProgress(null);
      Alert.alert("Erreur", String(e));
    }
  }

  function handleDeleteDirectory() {
    if (!selectedRepo) {
      Alert.alert("Erreur", "Sélectionnez un dépôt d'abord");
      return;
    }
    const path = deletePath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!path) {
      Alert.alert("Erreur", "Entrez le chemin du répertoire à supprimer");
      return;
    }
    if (!deleteMsg.trim()) {
      Alert.alert("Erreur", "Entrez un message de commit");
      return;
    }

    Alert.alert(
      "Confirmer la suppression",
      `Supprimer définitivement le répertoire "${path}" (et tout son contenu) de ${selectedRepo.name}/${currentBranch} ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            const res = await deleteDirectory(path, deleteMsg.trim());
            setDeleting(false);
            if (res.ok) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setDeletePath("");
              Alert.alert("Succès", `Répertoire supprimé (${res.deletedCount ?? 0} fichier(s) retiré(s)).`);
            } else {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Erreur", res.error ?? "Erreur inconnue");
            }
          },
        },
      ]
    );
  }

  function handleEmptyRepo() {
    if (!selectedRepo) return;
    Alert.alert(
      "Vider le dépôt",
      `Supprimer TOUS les fichiers de « ${selectedRepo.full_name} » sur la branche ${currentBranch} ?\n\nLe dépôt et son historique sont conservés, mais tous les fichiers actuels seront supprimés.`,
      [
        { text: "Non", style: "cancel" },
        {
          text: "Oui",
          style: "destructive",
          onPress: async () => {
            setEmptyingRepo(true);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            const res = await emptyRepo("chore: vidage complet du dépôt via Gitcrush");
            setEmptyingRepo(false);
            if (res.ok) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Succès", `Dépôt vidé : ${res.deletedCount ?? 0} fichier(s) supprimé(s).`);
            } else {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Erreur", res.error ?? "Erreur inconnue");
            }
          },
        },
      ]
    );
  }

  function handleDeleteRepo() {
    if (!selectedRepo) return;
    Alert.alert(
      "Supprimer le dépôt",
      `Supprimer DÉFINITIVEMENT le dépôt « ${selectedRepo.full_name} » sur GitHub ?\n\nCette action est irréversible : tout le code, les branches et l'historique seront perdus.`,
      [
        { text: "Non", style: "cancel" },
        {
          text: "Oui",
          style: "destructive",
          onPress: async () => {
            setDeletingRepo(true);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            const res = await deleteRepo();
            setDeletingRepo(false);
            if (res.ok) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Succès", "Le dépôt a été supprimé.");
            } else {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Erreur", res.error ?? "Erreur inconnue");
            }
          },
        },
      ]
    );
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const s = makeStyles(colors);
  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + webTop }]}>
        <Text style={s.headerTitle}>Fichiers</Text>
        {file && (
          <Pressable onPress={() => setFile(null)}>
            <Text style={{ color: colors.destructive, fontFamily: "Inter_500Medium", fontSize: 14 }}>Vider</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Repo selector */}
        <View style={s.card}>
          <Text style={s.cardLabel}>DÉPÔT</Text>
          <Pressable
            style={s.selector}
            onPress={() => { setShowRepoList((v) => !v); setShowBranchList(false); }}
          >
            <Octicons name="repo" size={15} color={colors.mutedForeground} />
            <Text style={[s.selectorText, !selectedRepo && { color: colors.mutedForeground }]}>
              {selectedRepo ? selectedRepo.full_name : "Sélectionner un dépôt..."}
            </Text>
            <Feather name={showRepoList ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
          </Pressable>

          {showRepoList && (
            <View style={s.dropdown}>
              <TextInput
                style={s.searchInput}
                value={repoSearch}
                onChangeText={setRepoSearch}
                placeholder="Rechercher..."
                placeholderTextColor={colors.mutedForeground}
              />
              {reposLoading ? (
                <ActivityIndicator color={colors.accent} style={{ padding: 16 }} />
              ) : (
                <ScrollView
                  style={{ maxHeight: 200 }}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {filteredRepos.length === 0 ? (
                    <Text style={{ color: colors.mutedForeground, padding: 12, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                      Aucun dépôt trouvé
                    </Text>
                  ) : (
                    filteredRepos.map((item: GitHubRepo) => (
                      <Pressable
                        key={item.id}
                        style={[s.dropdownItem, selectedRepo?.id === item.id && { backgroundColor: colors.greenBg }]}
                        onPress={() => {
                          selectRepo(item);
                          setShowRepoList(false);
                          setRepoSearch("");
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                      >
                        <Octicons name={item.private ? "lock" : "repo"} size={13} color={colors.mutedForeground} />
                        <Text style={s.dropdownItemText}>{item.name}</Text>
                        {selectedRepo?.id === item.id && (
                          <Feather name="check" size={14} color={colors.accent} />
                        )}
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {/* Branch selector */}
        {selectedRepo && (
          <View style={s.card}>
            <Text style={s.cardLabel}>BRANCHE</Text>
            <Pressable
              style={s.selector}
              onPress={() => { setShowBranchList((v) => !v); setShowRepoList(false); }}
            >
              <Octicons name="git-branch" size={15} color={colors.accent} />
              <Text style={s.selectorText}>{currentBranch}</Text>
              <Feather name={showBranchList ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
            </Pressable>
            {showBranchList && (
              <View style={s.dropdown}>
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator>
                  {branches.map((b) =>
                    branchToDelete === b.name ? (
                      <View key={b.name} style={[s.dropdownItem, { backgroundColor: "rgba(248, 81, 73, 0.12)" }]}>
                        <Feather name="trash-2" size={13} color={colors.destructive} />
                        <Text style={[s.dropdownItemText, { color: colors.destructive }]} numberOfLines={1}>
                          Supprimer « {b.name} » ?
                        </Text>
                        <Pressable
                          style={s.confirmYesBtn}
                          disabled={deletingBranch}
                          onPress={async () => {
                            setDeletingBranch(true);
                            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            const res = await deleteBranch(b.name);
                            setDeletingBranch(false);
                            setBranchToDelete(null);
                            if (res.ok) {
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            } else {
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                              Alert.alert("Erreur", res.error ?? "Erreur inconnue");
                            }
                          }}
                        >
                          {deletingBranch ? (
                            <ActivityIndicator color="#fff" size="small" />
                          ) : (
                            <Text style={s.confirmYesText}>Oui</Text>
                          )}
                        </Pressable>
                        <Pressable style={s.confirmNoBtn} onPress={() => setBranchToDelete(null)}>
                          <Text style={s.confirmNoText}>Non</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        key={b.name}
                        style={[s.dropdownItem, currentBranch === b.name && { backgroundColor: colors.greenBg }]}
                        delayLongPress={3000}
                        onLongPress={() => {
                          if (b.name === selectedRepo.default_branch) {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                            Alert.alert("Impossible", "La branche par défaut du dépôt ne peut pas être supprimée.");
                            return;
                          }
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          setBranchToDelete(b.name);
                        }}
                        onPress={() => {
                          selectBranch(b.name);
                          setShowBranchList(false);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                      >
                        <Octicons name="git-branch" size={13} color={colors.mutedForeground} />
                        <Text style={s.dropdownItemText}>{b.name}</Text>
                        {currentBranch === b.name && <Feather name="check" size={14} color={colors.accent} />}
                      </Pressable>
                    )
                  )}
                </ScrollView>
                <Text style={s.hint}>Restez appuyé 3 s sur une branche pour la supprimer.</Text>
              </View>
            )}
          </View>
        )}

        {/* Target path */}
        <View style={s.card}>
          <Text style={s.cardLabel}>CHEMIN CIBLE (optionnel)</Text>
          <View style={s.inputRow}>
            <Feather name="folder" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.pathInput}
              value={targetPath}
              onChangeText={setTargetPath}
              placeholder="ex: src/components"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Commit message */}
        <View style={s.card}>
          <Text style={s.cardLabel}>MESSAGE DE COMMIT</Text>
          <View style={s.inputRow}>
            <Octicons name="git-commit" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.pathInput}
              value={commitMsg}
              onChangeText={setCommitMsg}
              placeholder="Message de commit..."
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>

        {/* File picker (single file, zip auto-extracted) */}
        <View style={s.card}>
          <Text style={s.cardLabel}>FICHIER</Text>
          {!file ? (
            <Pressable style={s.pickBtn} onPress={pickFile}>
              <Feather name="upload" size={16} color={colors.foreground} />
              <Text style={s.pickBtnText}>Sélectionner un fichier</Text>
            </Pressable>
          ) : (
            <View style={s.fileList}>
              <View style={s.fileRow}>
                <Feather name={isZipFile(file) ? "archive" : "file"} size={14} color={colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={s.fileName} numberOfLines={1}>{file.name}</Text>
                  <Text style={s.fileSize}>{formatSize(file.size)}</Text>
                </View>
                <Pressable onPress={removeFile}>
                  <Feather name="x" size={16} color={colors.destructive} />
                </Pressable>
              </View>
              <Pressable style={[s.pickBtn, { marginTop: 0 }]} onPress={pickFile}>
                <Feather name="refresh-cw" size={14} color={colors.foreground} />
                <Text style={s.pickBtnText}>Remplacer le fichier</Text>
              </Pressable>
            </View>
          )}
          <Text style={s.hint}>
            Chaque fichier remplace automatiquement l'ancien fichier du même nom dans son répertoire d'origine. Un .zip est extrait et tous ses fichiers sont pushés de la même façon. Renseignez un chemin cible pour forcer un emplacement précis.
          </Text>
        </View>

        {/* Push button */}
        <Pressable
          style={({ pressed }) => [
            s.pushBtn,
            { opacity: pressed || pushing || !selectedRepo || !file ? 0.6 : 1 },
          ]}
          onPress={handlePush}
          disabled={pushing || !selectedRepo || !file}
        >
          {pushing ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator color="#fff" />
              {pushProgress && (
                <Text style={s.pushBtnText}>{pushProgress.done}/{pushProgress.total}</Text>
              )}
            </View>
          ) : (
            <>
              <Octicons name="upload" size={16} color="#fff" />
              <Text style={s.pushBtnText}>
                {file && isZipFile(file) ? "Extraire et pusher le zip" : "Pusher le fichier"}
              </Text>
            </>
          )}
        </Pressable>

        {/* Delete directory */}
        {selectedRepo && (
          <View style={[s.card, { marginTop: 20, borderColor: colors.destructive }]}>
            <Text style={[s.cardLabel, { color: colors.destructive }]}>SUPPRIMER UN RÉPERTOIRE</Text>
            <View style={s.inputRow}>
              <Feather name="folder-minus" size={15} color={colors.destructive} />
              <TextInput
                style={s.pathInput}
                value={deletePath}
                onChangeText={setDeletePath}
                placeholder="ex: src/old-components"
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>
            <View style={[s.inputRow, { borderTopWidth: 1, borderColor: colors.border }]}>
              <Octicons name="git-commit" size={15} color={colors.mutedForeground} />
              <TextInput
                style={s.pathInput}
                value={deleteMsg}
                onChangeText={setDeleteMsg}
                placeholder="Message de commit..."
                placeholderTextColor={colors.mutedForeground}
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                s.deleteBtn,
                { opacity: pressed || deleting || !deletePath.trim() ? 0.6 : 1 },
              ]}
              onPress={handleDeleteDirectory}
              disabled={deleting || !deletePath.trim()}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="trash-2" size={16} color="#fff" />
                  <Text style={s.pushBtnText}>Supprimer le répertoire</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Vider le dépôt (tous les fichiers, le dépôt reste) */}
        <Pressable
          style={({ pressed }) => [
            s.emptyRepoBtn,
            { opacity: pressed || emptyingRepo || !selectedRepo ? 0.6 : 1 },
          ]}
          onPress={handleEmptyRepo}
          disabled={emptyingRepo || !selectedRepo}
        >
          {emptyingRepo ? (
            <ActivityIndicator color={colors.destructive} />
          ) : (
            <>
              <Feather name="wind" size={16} color={colors.destructive} />
              <Text style={s.emptyRepoBtnText}>
                {selectedRepo ? `Vider le dépôt « ${selectedRepo.name} »` : "Vider le dépôt"}
              </Text>
            </>
          )}
        </Pressable>

        {/* Supprimer le dépôt sélectionné — tout en bas de la page */}
        <Pressable
          style={({ pressed }) => [
            s.deleteRepoBtn,
            { opacity: pressed || deletingRepo || !selectedRepo ? 0.6 : 1 },
          ]}
          onPress={handleDeleteRepo}
          disabled={deletingRepo || !selectedRepo}
        >
          {deletingRepo ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="trash-2" size={16} color="#fff" />
              <Text style={s.pushBtnText}>
                {selectedRepo ? `Supprimer le dépôt « ${selectedRepo.name} »` : "Supprimer le dépôt"}
              </Text>
            </>
          )}
        </Pressable>

        <View style={{ height: insets.bottom + (Platform.OS === "web" ? 34 : 90) }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: { flex: 1, fontSize: 20, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    scroll: { flex: 1 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      margin: 12,
      marginBottom: 0,
      overflow: "hidden",
    },
    cardLabel: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.8,
      paddingHorizontal: 14,
      paddingTop: 12,
      paddingBottom: 6,
    },
    selector: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    selectorText: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_500Medium" },
    dropdown: {
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      padding: 10,
      paddingHorizontal: 14,
      fontSize: 13,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    dropdownItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    dropdownItemText: { flex: 1, fontSize: 13, color: colors.foreground, fontFamily: "Inter_400Regular" },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    pathInput: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_400Regular" },
    pickBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      margin: 12,
      marginTop: 4,
      padding: 14,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderStyle: "dashed",
    },
    pickBtnText: { fontSize: 14, color: colors.foreground, fontFamily: "Inter_500Medium" },
    fileList: { borderTopWidth: 1, borderColor: colors.border },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    fileName: { fontSize: 13, color: colors.foreground, fontFamily: "Inter_500Medium" },
    fileSize: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    hint: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      paddingHorizontal: 14,
      paddingBottom: 12,
      paddingTop: 2,
      lineHeight: 15,
    },
    pushBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.primary,
      margin: 12,
      marginTop: 16,
      padding: 16,
      borderRadius: colors.radius,
    },
    pushBtnText: { fontSize: 16, fontWeight: "700" as const, color: "#fff", fontFamily: "Inter_700Bold" },
    deleteBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.destructive,
      margin: 12,
      marginTop: 4,
      padding: 16,
      borderRadius: colors.radius,
    },
    confirmYesBtn: {
      backgroundColor: colors.destructive,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
      minWidth: 46,
      alignItems: "center",
    },
    confirmYesText: { fontSize: 12, fontWeight: "700" as const, color: "#fff", fontFamily: "Inter_700Bold" },
    confirmNoBtn: {
      borderWidth: 1.5,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
      minWidth: 46,
      alignItems: "center",
    },
    confirmNoText: { fontSize: 12, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    deleteRepoBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.destructive,
      margin: 12,
      marginTop: 8,
      padding: 16,
      borderRadius: colors.radius,
    },
    emptyRepoBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderWidth: 1.5,
      borderColor: colors.destructive,
      margin: 12,
      marginTop: 24,
      marginBottom: 0,
      padding: 16,
      borderRadius: colors.radius,
    },
    emptyRepoBtnText: { fontSize: 16, fontWeight: "700" as const, color: colors.destructive, fontFamily: "Inter_700Bold" },
  });
      }
