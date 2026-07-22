import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  ActivityIndicator,
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

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useGitHub();

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);

  async function handleLogin() {
    if (!token.trim()) {
      setError("Veuillez entrer votre token GitHub");
      return;
    }
    setError("");
    setLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ok = await login(token.trim());
    setLoading(false);
    if (ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/files");
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError("Token invalide. Vérifiez vos droits (scope: repo)");
    }
  }

  function openTokenPage() {
    WebBrowser.openBrowserAsync(
      "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Gitcrush+App"
    );
  }

  const s = makeStyles(colors);

  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20), paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={s.logoWrap}>
          <View style={s.logoCircle}>
            <Octicons name="mark-github" size={40} color={colors.foreground} />
          </View>
          <Text style={s.appName}>Gitcrush</Text>
          <Text style={s.tagline}>Connectez-vous avec votre compte GitHub</Text>
        </View>

        {/* Steps */}
        <View style={s.stepsCard}>
          <Text style={s.stepsTitle}>Comment se connecter</Text>
          {[
            { n: "1", text: "Cliquez sur « Créer un token » ci-dessous" },
            { n: "2", text: "Activez le scope « repo » puis générez le token" },
            { n: "3", text: "Copiez le token et collez-le dans le champ ci-dessous" },
          ].map((step) => (
            <View key={step.n} style={s.step}>
              <View style={s.stepNum}>
                <Text style={s.stepNumText}>{step.n}</Text>
              </View>
              <Text style={s.stepText}>{step.text}</Text>
            </View>
          ))}
        </View>

        {/* Token input */}
        <View style={s.inputWrap}>
          <Text style={s.inputLabel}>Personal Access Token</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              value={token}
              onChangeText={setToken}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry={!showToken}
              autoCorrect={false}
              autoCapitalize="none"
              onSubmitEditing={handleLogin}
            />
            <Pressable style={s.eyeBtn} onPress={() => setShowToken((v) => !v)}>
              <Feather name={showToken ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {!!error && <Text style={s.error}>{error}</Text>}
        </View>

        {/* Connect button */}
        <Pressable
          style={({ pressed }) => [s.loginBtn, pressed && { opacity: 0.8 }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Octicons name="mark-github" size={18} color="#fff" />
              <Text style={s.loginBtnText}>Se connecter</Text>
            </>
          )}
        </Pressable>

        {/* Create token button */}
        <Pressable
          style={({ pressed }) => [s.tokenBtn, pressed && { opacity: 0.7 }]}
          onPress={openTokenPage}
        >
          <Feather name="external-link" size={15} color={colors.accent} />
          <Text style={s.tokenBtnText}>Créer un token GitHub</Text>
        </Pressable>

        <Text style={s.note}>
          Votre token est stocké localement et n'est jamais partagé.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    scroll: { paddingHorizontal: 24 },
    logoWrap: { alignItems: "center", marginBottom: 32 },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    appName: {
      fontSize: 28,
      fontWeight: "700" as const,
      color: colors.foreground,
      fontFamily: "Inter_700Bold",
      marginBottom: 6,
    },
    tagline: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: "Inter_400Regular",
      textAlign: "center",
    },
    stepsCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 24,
    },
    stepsTitle: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 12,
    },
    step: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
    stepNum: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.greenBg,
      borderWidth: 1,
      borderColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
      marginTop: 1,
    },
    stepNumText: { fontSize: 11, color: colors.green, fontWeight: "700" as const },
    stepText: { flex: 1, fontSize: 14, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 20 },
    inputWrap: { marginBottom: 16 },
    inputLabel: {
      fontSize: 12,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.input,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    input: {
      flex: 1,
      padding: 14,
      fontSize: 14,
      color: colors.foreground,
      fontFamily: "Inter_400Regular",
    },
    eyeBtn: { padding: 14 },
    error: {
      fontSize: 13,
      color: colors.destructive,
      fontFamily: "Inter_400Regular",
      marginTop: 6,
    },
    loginBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginBottom: 12,
    },
    loginBtnText: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: "#fff",
      fontFamily: "Inter_700Bold",
    },
    tokenBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 14,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
    },
    tokenBtnText: {
      fontSize: 14,
      color: colors.accent,
      fontFamily: "Inter_500Medium",
    },
    note: {
      fontSize: 12,
      color: colors.mutedForeground,
      textAlign: "center",
      fontFamily: "Inter_400Regular",
      lineHeight: 18,
    },
  });
}
