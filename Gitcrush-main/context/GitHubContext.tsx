import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  public_repos: number;
  email: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  updated_at: string;
  description: string | null;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string; avatar_url: string } | null;
}

interface GitHubContextType {
  token: string | null;
  user: GitHubUser | null;
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  branches: GitHubBranch[];
  currentBranch: string;
  commits: GitHubCommit[];
  loading: boolean;
  reposLoading: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => Promise<void>;
  selectRepo: (repo: GitHubRepo | null) => Promise<void>;
  selectBranch: (branch: string) => Promise<void>;
  fetchRepos: () => Promise<void>;
  refreshCommits: () => Promise<void>;
  pushFile: (path: string, content: string, message: string) => Promise<{ ok: boolean; error?: string }>;
  deleteDirectory: (dirPath: string, message: string) => Promise<{ ok: boolean; error?: string; deletedCount?: number }>;
  deleteBranch: (branchName: string) => Promise<{ ok: boolean; error?: string }>;
  deleteRepo: () => Promise<{ ok: boolean; error?: string }>;
  emptyRepo: (message: string) => Promise<{ ok: boolean; error?: string; deletedCount?: number }>;
  getTreePaths: () => Promise<string[]>;
}

const GitHubContext = createContext<GitHubContextType | null>(null);

const TOKEN_KEY = "@gitsync_token";
const REPO_KEY = "@gitsync_repo";
const BRANCH_KEY = "@gitsync_branch";

const GH_HEADERS = (tok: string) => ({
  Authorization: `token ${tok}`,
  Accept: "application/vnd.github.v3+json",
  "Content-Type": "application/json",
});

async function ghFetch(tok: string, path: string, options?: RequestInit) {
  return fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...GH_HEADERS(tok), ...(options?.headers ?? {}) },
  });
}

export function GitHubProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>("main");
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(false);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    try {
      const tok = await AsyncStorage.getItem(TOKEN_KEY);
      if (!tok) return;
      const ok = await verifyToken(tok);
      if (!ok) return;
      const repoJson = await AsyncStorage.getItem(REPO_KEY);
      const branchStr = await AsyncStorage.getItem(BRANCH_KEY);
      if (repoJson) {
        const repo = JSON.parse(repoJson) as GitHubRepo;
        setSelectedRepo(repo);
        const branch = branchStr || repo.default_branch;
        setCurrentBranch(branch);
        void loadBranches(tok, repo);
        void loadCommits(tok, repo, branch);
      }
      void loadRepos(tok);
    } finally {
      setLoading(false);
    }
  }

  async function verifyToken(tok: string): Promise<boolean> {
    try {
      const res = await ghFetch(tok, "/user");
      if (!res.ok) return false;
      const u = (await res.json()) as GitHubUser;
      setToken(tok);
      setUser(u);
      return true;
    } catch {
      return false;
    }
  }

  async function login(tok: string): Promise<boolean> {
    const ok = await verifyToken(tok);
    if (ok) {
      await AsyncStorage.setItem(TOKEN_KEY, tok);
      void loadRepos(tok);
    }
    return ok;
  }

  async function logout() {
    await AsyncStorage.multiRemove([TOKEN_KEY, REPO_KEY, BRANCH_KEY]);
    setToken(null);
    setUser(null);
    setRepos([]);
    setSelectedRepo(null);
    setBranches([]);
    setCommits([]);
    setCurrentBranch("main");
  }

  async function loadRepos(tok: string) {
    setReposLoading(true);
    try {
      const res = await ghFetch(tok, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator");
      if (res.ok) {
        const data = (await res.json()) as GitHubRepo[];
        setRepos(data);
      }
    } finally {
      setReposLoading(false);
    }
  }

  async function loadBranches(tok: string, repo: GitHubRepo) {
    try {
      const res = await ghFetch(tok, `/repos/${repo.full_name}/branches`);
      if (res.ok) {
        const data = (await res.json()) as GitHubBranch[];
        setBranches(data);
      }
    } catch {/**/}
  }

  async function loadCommits(tok: string, repo: GitHubRepo, branch: string) {
    try {
      const res = await ghFetch(tok, `/repos/${repo.full_name}/commits?sha=${branch}&per_page=30`);
      if (res.ok) {
        const data = (await res.json()) as GitHubCommit[];
        setCommits(Array.isArray(data) ? data : []);
      } else {
        setCommits([]);
      }
    } catch {
      setCommits([]);
    }
  }

  async function fetchRepos() {
    if (!token) return;
    await loadRepos(token);
  }

  async function refreshCommits() {
    if (!token || !selectedRepo) return;
    await loadCommits(token, selectedRepo, currentBranch);
  }

  async function selectRepo(repo: GitHubRepo | null) {
    setSelectedRepo(repo);
    setCommits([]);
    setBranches([]);
    if (!repo) {
      await AsyncStorage.removeItem(REPO_KEY);
      return;
    }
    await AsyncStorage.setItem(REPO_KEY, JSON.stringify(repo));
    const branch = repo.default_branch;
    setCurrentBranch(branch);
    await AsyncStorage.setItem(BRANCH_KEY, branch);
    if (token) {
      void loadBranches(token, repo);
      void loadCommits(token, repo, branch);
    }
  }

  async function selectBranch(branch: string) {
    setCurrentBranch(branch);
    setCommits([]);
    await AsyncStorage.setItem(BRANCH_KEY, branch);
    if (token && selectedRepo) {
      void loadCommits(token, selectedRepo, branch);
    }
  }

  async function pushFile(path: string, content: string, message: string): Promise<{ ok: boolean; error?: string }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    try {
      let sha: string | undefined;
      const checkRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/contents/${path}?ref=${currentBranch}`);
      if (checkRes.ok) {
        const existing = (await checkRes.json()) as { sha: string };
        sha = existing.sha;
      }

      const body: Record<string, string> = { message, content, branch: currentBranch };
      if (sha) body.sha = sha;

      const res = await ghFetch(token, `/repos/${selectedRepo.full_name}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        void loadCommits(token, selectedRepo, currentBranch);
        return { ok: true };
      }
      const err = (await res.json()) as { message?: string };
      return { ok: false, error: err.message ?? "Erreur GitHub" };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function deleteDirectory(
    dirPath: string,
    message: string
  ): Promise<{ ok: boolean; error?: string; deletedCount?: number }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    const cleanDir = dirPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleanDir) return { ok: false, error: "Chemin de répertoire invalide" };

    try {
      // 1. Ref de la branche -> sha du commit courant
      const refRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/ref/heads/${currentBranch}`);
      if (!refRes.ok) return { ok: false, error: "Impossible de lire la branche" };
      const refData = (await refRes.json()) as { object: { sha: string } };
      const commitSha = refData.object.sha;

      // 2. Commit -> sha de l'arbre racine
      const commitRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/commits/${commitSha}`);
      if (!commitRes.ok) return { ok: false, error: "Impossible de lire le commit" };
      const commitData = (await commitRes.json()) as { tree: { sha: string } };
      const rootTreeSha = commitData.tree.sha;

      // 3. Arbre complet et récursif
      const treeRes = await ghFetch(
        token,
        `/repos/${selectedRepo.full_name}/git/trees/${rootTreeSha}?recursive=1`
      );
      if (!treeRes.ok) return { ok: false, error: "Impossible de lire l'arborescence" };
      const treeData = (await treeRes.json()) as {
        tree: { path: string; mode: string; type: string; sha: string }[];
        truncated?: boolean;
      };

      const toRemove = (p: string) => p === cleanDir || p.startsWith(`${cleanDir}/`);
      const remaining = treeData.tree.filter((e) => e.type === "blob" && !toRemove(e.path));
      const removedCount = treeData.tree.filter((e) => e.type === "blob" && toRemove(e.path)).length;

      if (removedCount === 0) {
        return { ok: false, error: "Répertoire introuvable ou déjà vide" };
      }

      // 4. Nouvel arbre reconstruit sans les fichiers du répertoire ciblé
      const newTreeRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/trees`, {
        method: "POST",
        body: JSON.stringify({
          tree: remaining.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha })),
        }),
      });
      if (!newTreeRes.ok) return { ok: false, error: "Échec de la création du nouvel arbre" };
      const newTreeData = (await newTreeRes.json()) as { sha: string };

      // 5. Nouveau commit
      const newCommitRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message,
          tree: newTreeData.sha,
          parents: [commitSha],
        }),
      });
      if (!newCommitRes.ok) return { ok: false, error: "Échec de la création du commit" };
      const newCommitData = (await newCommitRes.json()) as { sha: string };

      // 6. Mise à jour de la branche
      const updateRefRes = await ghFetch(
        token,
        `/repos/${selectedRepo.full_name}/git/refs/heads/${currentBranch}`,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: newCommitData.sha }),
        }
      );
      if (!updateRefRes.ok) return { ok: false, error: "Échec de la mise à jour de la branche" };

      void loadCommits(token, selectedRepo, currentBranch);
      return { ok: true, deletedCount: removedCount };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function deleteBranch(branchName: string): Promise<{ ok: boolean; error?: string }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    if (branchName === selectedRepo.default_branch) {
      return { ok: false, error: "Impossible de supprimer la branche par défaut du dépôt" };
    }
    try {
      const res = await ghFetch(
        token,
        `/repos/${selectedRepo.full_name}/git/refs/heads/${branchName}`,
        { method: "DELETE" }
      );
      if (res.status === 204) {
        setBranches((prev) => prev.filter((b) => b.name !== branchName));
        if (currentBranch === branchName) {
          await selectBranch(selectedRepo.default_branch);
        }
        return { ok: true };
      }
      let msg = "Erreur GitHub";
      try {
        const err = (await res.json()) as { message?: string };
        msg = err.message ?? msg;
      } catch {/**/}
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function deleteRepo(): Promise<{ ok: boolean; error?: string }> {
    if (!token || !selectedRepo) return { ok: false, error: "Aucun dépôt sélectionné" };
    try {
      const res = await ghFetch(token, `/repos/${selectedRepo.full_name}`, { method: "DELETE" });
      if (res.status === 204) {
        const deletedId = selectedRepo.id;
        setRepos((prev) => prev.filter((r) => r.id !== deletedId));
        setSelectedRepo(null);
        setBranches([]);
        setCommits([]);
        setCurrentBranch("main");
        await AsyncStorage.multiRemove([REPO_KEY, BRANCH_KEY]);
        return { ok: true };
      }
      if (res.status === 403) {
        return {
          ok: false,
          error: "Permission refusée : votre token GitHub doit avoir le scope « delete_repo ».",
        };
      }
      let msg = "Erreur GitHub";
      try {
        const err = (await res.json()) as { message?: string };
        msg = err.message ?? msg;
      } catch {/**/}
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** Vide complètement la branche courante : un commit pointant sur l'arbre vide de git supprime tous les fichiers. */
  async function emptyRepo(message: string): Promise<{ ok: boolean; error?: string; deletedCount?: number }> {
    if (!token || !selectedRepo) return { ok: false, error: "Non authentifié" };
    // SHA de l'arbre vide, identique dans tous les dépôts git
    const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    try {
      // 1. Ref de la branche → sha du commit courant
      const refRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/ref/heads/${currentBranch}`);
      if (!refRes.ok) return { ok: false, error: "Impossible de lire la branche" };
      const refData = (await refRes.json()) as { object: { sha: string } };
      const commitSha = refData.object.sha;

      // 2. Compter les fichiers actuels (retour utilisateur)
      let deletedCount = 0;
      const treeRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/trees/${currentBranch}?recursive=1`);
      if (treeRes.ok) {
        const treeData = (await treeRes.json()) as { tree?: { type: string }[] };
        deletedCount = (treeData.tree ?? []).filter((e) => e.type === "blob").length;
      }
      if (deletedCount === 0) return { ok: false, error: "Le dépôt est déjà vide" };

      // 3. Nouveau commit pointant sur l'arbre vide
      const newCommitRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/commits`, {
        method: "POST",
        body: JSON.stringify({ message, tree: EMPTY_TREE_SHA, parents: [commitSha] }),
      });
      if (!newCommitRes.ok) return { ok: false, error: "Échec de la création du commit de vidage" };
      const newCommitData = (await newCommitRes.json()) as { sha: string };

      // 4. Mise à jour de la branche
      const updateRefRes = await ghFetch(token, `/repos/${selectedRepo.full_name}/git/refs/heads/${currentBranch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommitData.sha }),
      });
      if (!updateRefRes.ok) {
        let msg = "Échec de la mise à jour de la branche";
        try {
          const err = (await updateRefRes.json()) as { message?: string };
          msg = err.message ?? msg;
        } catch {/**/}
        return { ok: false, error: msg };
      }

      void loadCommits(token, selectedRepo, currentBranch);
      return { ok: true, deletedCount };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** Liste les chemins de tous les fichiers de la branche courante (pour retrouver l'emplacement d'un ancien fichier). */
  async function getTreePaths(): Promise<string[]> {
    if (!token || !selectedRepo) return [];
    try {
      const res = await ghFetch(
        token,
        `/repos/${selectedRepo.full_name}/git/trees/${currentBranch}?recursive=1`
      );
      if (!res.ok) return []; // dépôt vide ou branche introuvable → tout sera créé
      const data = (await res.json()) as { tree?: { path: string; type: string }[] };
      return (data.tree ?? []).filter((e) => e.type === "blob").map((e) => e.path);
    } catch {
      return [];
    }
  }

  return (
    <GitHubContext.Provider
      value={{
        token, user, repos, selectedRepo, branches, currentBranch,
        commits, loading, reposLoading,
        login, logout, selectRepo, selectBranch,
        fetchRepos, refreshCommits, pushFile, deleteDirectory,
        deleteBranch, deleteRepo, emptyRepo, getTreePaths,
      }}
    >
      {children}
    </GitHubContext.Provider>
  );
}

export function useGitHub() {
  const ctx = useContext(GitHubContext);
  if (!ctx) throw new Error("useGitHub must be inside GitHubProvider");
  return ctx;
}
