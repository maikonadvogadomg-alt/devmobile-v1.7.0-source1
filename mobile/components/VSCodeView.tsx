import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { useApp } from "@/context/AppContext";
import { useApiBase } from "@/hooks/useApiBase";

const VSCODE_SESSION = "vscode_workspace";

function detectLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    kt: "kotlin", swift: "swift", cs: "csharp", cpp: "cpp", c: "c",
    html: "html", css: "css", scss: "scss", json: "json", yaml: "yaml",
    yml: "yaml", md: "markdown", sh: "bash", txt: "plaintext",
    xml: "xml", sql: "sql", php: "php",
  };
  return map[ext] ?? "plaintext";
}

type UploadSt = "idle" | "uploading" | "done" | "error";
type DlSt = "idle" | "downloading" | "done" | "error";

type Mode = "codeserver" | "vscodedev" | "githubdev" | "guide";

const STATIC_MODE_URLS: Record<Mode, string> = {
  codeserver: "https://vscode.dev",
  vscodedev:  "https://vscode.dev",
  githubdev:  "https://github.dev",
  guide:      "about:blank",
};

const MODE_LABELS: Record<Mode, string> = {
  codeserver: "VS Code",
  vscodedev:  "vscode.dev",
  githubdev:  "github.dev",
  guide:      "Guia",
};

export default function VSCodeView({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { activeProject, updateProject } = useApp();
  const apiBase = useApiBase();
  const TERMINAL_API = apiBase ? `${apiBase}/api/terminal` : "";
  const CODE_SERVER_URL = apiBase ? `${apiBase}/` : "";
  const MODE_URLS: Record<Mode, string> = {
    ...STATIC_MODE_URLS,
    codeserver: CODE_SERVER_URL || "https://vscode.dev",
  };
  const webRef = useRef<WebView>(null);

  const [mode, setMode] = useState<Mode>("codeserver");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploadSt, setUploadSt] = useState<UploadSt>("idle");
  const [dlSt, setDlSt] = useState<DlSt>("idle");

  // Track if the FIRST load completed — don't re-show spinner for VS Code internal navigations
  const firstLoadDone = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLoadTimeout = () => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  };

  const startLoadTimeout = useCallback(() => {
    clearLoadTimeout();
    loadTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setLoadFailed(true);
    }, 40000); // 40s max wait
  }, []);

  // Reset when opened
  useEffect(() => {
    if (visible) {
      setMode("codeserver");
      setLoading(true);
      setLoadFailed(false);
      firstLoadDone.current = false;
      startLoadTimeout();
    } else {
      clearLoadTimeout();
    }
  }, [visible, startLoadTimeout]);

  useEffect(() => () => clearLoadTimeout(), []);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setLoading(true);
    setLoadFailed(false);
    firstLoadDone.current = false;
    startLoadTimeout();
    Haptics.selectionAsync();
  }, [startLoadTimeout]);

  // ── Upload project → server workspace ──────────────────────────────────────
  const uploadProject = useCallback(async () => {
    if (!activeProject || !TERMINAL_API) {
      Alert.alert("Sem projeto", "Abra um projeto primeiro na aba Projetos.", [{ text: "OK" }]);
      return;
    }
    setUploadSt("uploading");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${TERMINAL_API}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: VSCODE_SESSION,
          files: activeProject.files.map((f) => ({ path: f.name, content: f.content })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUploadSt("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "✅ Projeto enviado!",
        `${data.count} arquivo(s) de "${activeProject.name}" no servidor.\n\nNo VS Code: File → Open Folder → /tmp/devmobile-sessions/vscode_workspace`,
        [{ text: "OK" }],
      );
      setTimeout(() => setUploadSt("idle"), 4000);
    } catch (e: any) {
      setUploadSt("error");
      Alert.alert("Erro", `${e?.message ?? String(e)}`, [{ text: "OK" }]);
      setTimeout(() => setUploadSt("idle"), 3000);
    }
  }, [activeProject]);

  // ── Download project ← server workspace ────────────────────────────────────
  const downloadProject = useCallback(async () => {
    if (!activeProject || !TERMINAL_API) {
      Alert.alert("Sem projeto", "Nenhum projeto ativo.", [{ text: "OK" }]);
      return;
    }
    setDlSt("downloading");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${TERMINAL_API}/read?sessionId=${VSCODE_SESSION}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const serverFiles: Array<{ path: string; content: string }> = data.files ?? [];
      if (serverFiles.length === 0) {
        Alert.alert("Nenhum arquivo", "Workspace vazio. Envie o projeto primeiro com '↑ Enviar'.");
        setDlSt("idle");
        return;
      }
      const existingMap = new Map(activeProject.files.map((f) => [f.name, f]));
      for (const sf of serverFiles) {
        const ex = existingMap.get(sf.path);
        existingMap.set(sf.path, ex
          ? { ...ex, content: sf.content, isDirty: true }
          : { id: `srv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: sf.path, path: sf.path, content: sf.content, language: detectLanguage(sf.path), isDirty: true }
        );
      }
      updateProject(activeProject.id, { files: Array.from(existingMap.values()) });
      setDlSt("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("✅ Sincronizado!", `${serverFiles.length} arquivo(s) baixados do servidor.`, [{ text: "OK" }]);
      setTimeout(() => setDlSt("idle"), 4000);
    } catch (e: any) {
      setDlSt("error");
      Alert.alert("Erro", `${e?.message ?? String(e)}`, [{ text: "OK" }]);
      setTimeout(() => setDlSt("idle"), 3000);
    }
  }, [activeProject, updateProject]);

  const ucol = uploadSt === "uploading" ? "#f59e0b" : uploadSt === "done" ? "#10b981" : uploadSt === "error" ? "#ef4444" : "#007acc";
  const ulbl = uploadSt === "uploading" ? "Enviando…" : uploadSt === "done" ? "✓ Enviado!" : uploadSt === "error" ? "Erro!" : "↑ Enviar";
  const dcol = dlSt === "downloading" ? "#f59e0b" : dlSt === "done" ? "#10b981" : dlSt === "error" ? "#ef4444" : "#22c55e";
  const dlbl = dlSt === "downloading" ? "Baixando…" : dlSt === "done" ? "✓ Sincronizado!" : dlSt === "error" ? "Erro!" : "↓ Baixar";

  const currentUrl = MODE_URLS[mode];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {/* ── Top bar ── */}
        <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
          {/* Close + title */}
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={18} color="#aaa" />
          </TouchableOpacity>

          {/* Mode tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 4, paddingHorizontal: 8, alignItems: "center" }}>
            {(["codeserver", "vscodedev", "githubdev", "guide"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => switchMode(m)}
                style={[styles.modeTab, mode === m && styles.modeTabActive]}
              >
                {m === "codeserver" && (
                  <View style={{
                    width: 16, height: 16,
                    backgroundColor: mode === m ? "#007acc" : "#333",
                    borderRadius: 3,
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <Text style={{ color: "#fff", fontSize: 7, fontWeight: "900", letterSpacing: -0.5 }}>{"</>"}</Text>
                  </View>
                )}
                {m === "vscodedev" && <Feather name="globe" size={11} color={mode === m ? "#007acc" : "#888"} />}
                {m === "githubdev" && <Feather name="github" size={11} color={mode === m ? "#f0f0f0" : "#888"} />}
                {m === "guide" && <Feather name="book-open" size={11} color={mode === m ? "#4ade80" : "#888"} />}
                <Text style={[styles.modeTabText, mode === m && { color: m === "guide" ? "#4ade80" : "#007acc" }]}>
                  {MODE_LABELS[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Upload / Download */}
          <View style={styles.syncRow}>
            <TouchableOpacity
              onPress={uploadProject}
              disabled={uploadSt === "uploading"}
              style={[styles.syncBtn, { backgroundColor: ucol + "22", borderColor: ucol + "99" }]}
            >
              {uploadSt === "uploading"
                ? <ActivityIndicator size="small" color={ucol} />
                : <Feather name="upload" size={12} color={ucol} />}
              <Text style={[styles.syncText, { color: ucol }]}>{ulbl}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={downloadProject}
              disabled={dlSt === "downloading"}
              style={[styles.syncBtn, { backgroundColor: dcol + "22", borderColor: dcol + "99" }]}
            >
              {dlSt === "downloading"
                ? <ActivityIndicator size="small" color={dcol} />
                : <Feather name="download" size={12} color={dcol} />}
              <Text style={[styles.syncText, { color: dcol }]}>{dlbl}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setLoading(true); webRef.current?.reload(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={styles.reloadBtn}
            >
              <Feather name="refresh-cw" size={15} color="#64748b" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Guide tab ── */}
        {mode === "guide" ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <Text style={styles.guideTitle}>📖 Como usar o VS Code DevMobile</Text>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>🖥️ DevMobile IDE (aba principal)</Text>
              <Text style={styles.guideText}>Este é o VS Code REAL rodando no servidor — não é imitação. Tem terminal, extensões, Git, tudo.</Text>
              <View style={styles.guideSteps}>
                {[
                  "1. Toque em '↑ Enviar' para subir seu projeto para o servidor",
                  "2. No VS Code: File → Open Folder → /tmp/devmobile-sessions/vscode_workspace",
                  "3. Use o terminal integrado (View → Terminal ou Ctrl+`) — Linux real",
                  "4. Instale extensões: clique no ícone de extensões na barra lateral",
                  "5. Para Copilot: instale a extensão 'GitHub Copilot' e faça login com GitHub",
                  "6. Para Git: use o painel Source Control ou os comandos git no terminal",
                  "7. Quando terminar: toque em '↓ Baixar' para trazer as mudanças de volta",
                ].map((s, i) => (
                  <Text key={i} style={styles.guideStep}>{s}</Text>
                ))}
              </View>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>💻 Terminal no VS Code</Text>
              <Text style={styles.guideText}>Dentro do VS Code, abra o terminal integrado (View → Terminal). Todos os comandos rodam no mesmo servidor Linux:</Text>
              <View style={styles.guideCode}>
                {[
                  "npm install express          # instala qualquer pacote",
                  "pip3 install pandas          # Python também",
                  "git clone URL               # clone de repositório",
                  "git push origin main        # push para GitHub",
                  "node index.js               # roda seu código",
                  "python3 main.py             # Python",
                ].map((c, i) => (
                  <Text key={i} style={styles.codeText} selectable>{c}</Text>
                ))}
              </View>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>🤖 GitHub Copilot</Text>
              {[
                "1. No VS Code (aba DevMobile IDE), clique em Extensions (Ctrl+Shift+X)",
                "2. Busque: 'GitHub Copilot'",
                "3. Instale a extensão (botão Install)",
                "4. Faça login com sua conta GitHub que tem Copilot",
                "5. O Copilot fica disponível em todos os arquivos",
              ].map((s, i) => (
                <Text key={i} style={styles.guideStep}>{s}</Text>
              ))}
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>🐙 Git + GitHub</Text>
              {[
                "1. No terminal do VS Code: git clone https://github.com/SEU/REPO",
                "2. Para push com token: git remote set-url origin https://TOKEN@github.com/SEU/REPO.git",
                "3. Use o painel Source Control (ícone de galho) para commits visuais",
                "4. git status, git add ., git commit -m 'msg', git push",
              ].map((s, i) => (
                <Text key={i} style={styles.guideStep}>{s}</Text>
              ))}
            </View>

            <View style={[styles.guideSection, { backgroundColor: "#0d1a2d", borderColor: "#1e3a5f" }]}>
              <Text style={[styles.guideSectionTitle, { color: "#60a5fa" }]}>🌐 vscode.dev e github.dev</Text>
              <Text style={styles.guideText}>Alternativas online sem precisar do servidor. Funcionam com GitHub repos. Para terminal completo, use a aba DevMobile IDE.</Text>
            </View>
          </ScrollView>
        ) : (
          /* ── WebView ── */
          <View style={{ flex: 1, position: "relative" }}>
            {loading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#007acc" />
                <Text style={styles.loadingText}>
                  {mode === "codeserver"
                    ? "Iniciando VS Code no servidor…\nPode levar até 30 segundos na primeira vez."
                    : "Carregando…"}
                </Text>
              </View>
            )}
            {Platform.OS === "web" ? (
              // Web: use iframe to embed real VS Code
              <iframe
                src={currentUrl}
                style={{ flex: 1, width: "100%", height: "100%", border: "none" } as any}
                allow="clipboard-read; clipboard-write; storage-access-by-user-activation"
                onLoad={() => { clearLoadTimeout(); setLoading(false); }}
              />
            ) : loadFailed && mode === "codeserver" ? (
              // Failed to connect — show helpful message
              <View style={styles.failBox}>
                <Text style={styles.failIcon}>🔌</Text>
                <Text style={styles.failTitle}>VS Code não conectou</Text>
                <Text style={styles.failMsg}>
                  O servidor VS Code pode estar ainda iniciando ou o celular não conseguiu conectar.{"\n\n"}
                  Tente recarregar ou abra direto no Chrome.
                </Text>
                <TouchableOpacity
                  style={styles.failBtn}
                  onPress={() => {
                    setLoadFailed(false);
                    setLoading(true);
                    firstLoadDone.current = false;
                    startLoadTimeout();
                    webRef.current?.reload();
                  }}
                >
                  <Text style={styles.failBtnTxt}>↺  Tentar novamente</Text>
                </TouchableOpacity>
                {!!CODE_SERVER_URL && (
                  <TouchableOpacity
                    style={[styles.failBtn, { backgroundColor: "#1e3a5f", borderColor: "#3b82f6" }]}
                    onPress={() => {
                      const { Linking } = require("react-native");
                      Linking.openURL(CODE_SERVER_URL);
                    }}
                  >
                    <Text style={styles.failBtnTxt}>🌐  Abrir no Chrome</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.failUrl} selectable>{CODE_SERVER_URL}</Text>
              </View>
            ) : (
              <WebView
                ref={webRef}
                source={{ uri: currentUrl }}
                style={{ flex: 1 }}
                onLoadStart={() => {
                  // Only show our spinner on the VERY first navigation
                  // Subsequent navigations are VS Code's internal SPA routing
                  if (!firstLoadDone.current) {
                    setLoading(true);
                  }
                }}
                onLoadEnd={() => {
                  if (!firstLoadDone.current) {
                    firstLoadDone.current = true;
                    clearLoadTimeout();
                    setLoading(false);
                  }
                }}
                onLoad={() => {
                  if (!firstLoadDone.current) {
                    firstLoadDone.current = true;
                    clearLoadTimeout();
                    setLoading(false);
                  }
                }}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                allowFileAccess
                allowFileAccessFromFileURLs
                allowUniversalAccessFromFileURLs
                mixedContentMode="always"
                thirdPartyCookiesEnabled
                sharedCookiesEnabled
                setSupportMultipleWindows={false}
                userAgent="Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                onError={(e) => {
                  clearLoadTimeout();
                  setLoading(false);
                  setLoadFailed(true);
                  console.warn("WebView error", e.nativeEvent);
                }}
                onHttpError={(e) => {
                  clearLoadTimeout();
                  setLoading(false);
                  if (e.nativeEvent.statusCode >= 500) {
                    setLoadFailed(true);
                  }
                }}
              />
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1e1e1e" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111",
    paddingBottom: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#252526",
    gap: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e1e1e",
    borderRadius: 6,
    flexShrink: 0,
  },
  vsIcon: { alignItems: "center", justifyContent: "center" },
  modeTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "transparent",
  },
  modeTabActive: { borderColor: "#007acc44", backgroundColor: "#007acc11" },
  modeTabText: { color: "#888", fontSize: 11, fontWeight: "600" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  syncText: { fontSize: 11, fontWeight: "700" },
  reloadBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1e1e1e",
    borderRadius: 6,
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#1e1e1e",
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 40,
  },
  guideTitle: { color: "#4ade80", fontSize: 18, fontWeight: "800", marginBottom: 16, textAlign: "center" },
  guideSection: {
    backgroundColor: "#0d1f0d",
    borderWidth: 1,
    borderColor: "#1a4d1a",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  guideSectionTitle: { color: "#4ade80", fontWeight: "700", fontSize: 14, marginBottom: 8 },
  guideText: { color: "#94a3b8", fontSize: 13, lineHeight: 19, marginBottom: 8 },
  guideSteps: { gap: 4 },
  guideStep: { color: "#86efac", fontSize: 13, lineHeight: 20 },
  guideCode: {
    backgroundColor: "#0a0a0a",
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginTop: 4,
  },
  codeText: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#a5f3fc",
    fontSize: 12,
    lineHeight: 20,
  },
  failBox: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  failIcon: { fontSize: 52 },
  failTitle: { color: "#f87171", fontSize: 20, fontWeight: "800", textAlign: "center" },
  failMsg: { color: "#94a3b8", fontSize: 13, textAlign: "center", lineHeight: 20 },
  failBtn: {
    backgroundColor: "#1a2a1a",
    borderWidth: 1,
    borderColor: "#007acc",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    width: "100%",
  },
  failBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 15 },
  failUrl: { color: "#475569", fontSize: 10, textAlign: "center", marginTop: 8 },
});
