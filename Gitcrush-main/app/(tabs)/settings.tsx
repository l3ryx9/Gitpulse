import { Feather, Octicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGitHub } from "@/context/GitHubContext";
import { useColors } from "@/hooks/useColors";

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
          backgroundColor: pressed ? colors.secondary : "transparent",
        },
      ]}
      onPress={onPress}
    >
      <Feather name={icon as any} size={16} color={danger ? colors.destructive : colors.mutedForeground} />
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          color: danger ? colors.destructive : colors.foreground,
          fontFamily: "Inter_500Medium",
        }}
      >
        {label}
      </Text>
      {value && (
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          {value}
        </Text>
      )}
      {onPress && !danger && (
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, repos, logout, loading } = useGitHub();

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: "#0d1117", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color="#3fb950" size="large" />
    </View>
  );

  if (!user) return null;

  function confirmLogout() {
    Alert.alert(
      "Se déconnecter",
      "Votre token sera supprimé de l'appareil. Continuer ?",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Déconnecter",
          style: "destructive",
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await logout();
            router.replace("/login");
          },
        },
      ]
    );
  }

  const s = makeStyles(colors);
  const webTop = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: insets.top + webTop }]}>
        <Text style={s.headerTitle}>Paramètres</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile card */}
        <View style={s.profileCard}>
          {user.avatar_url ? (
            <Image source={{ uri: user.avatar_url }} style={s.avatar} contentFit="cover" />
          ) : (
            <View style={[s.avatar, { backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" }]}>
              <Octicons name="person" size={32} color={colors.mutedForeground} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.displayName}>{user.name || user.login}</Text>
            <Text style={s.username}>@{user.login}</Text>
            {user.email && <Text style={s.email}>{user.email}</Text>}
          </View>
          <View style={s.repoBadge}>
            <Text style={s.repoBadgeNum}>{repos.length}</Text>
            <Text style={s.repoBadgeLabel}>dépôts</Text>
          </View>
        </View>

        {/* GitHub section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>COMPTE</Text>
          <View style={s.card}>
            <Row icon="github" label="Profil GitHub" value={user.login} />
            <View style={s.divider} />
            <Row icon="git-branch" label="Dépôts" value={String(user.public_repos)} />
          </View>
        </View>

        {/* App section */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>APPLICATION</Text>
          <View style={s.card}>
            <Row icon="info" label="Version" value="1.0.0" />
            <View style={s.divider} />
            <Row icon="code" label="Gitcrush for GitHub" value="" />
          </View>
        </View>

        {/* Danger zone */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>DANGER</Text>
          <View style={s.card}>
            <Row icon="log-out" label="Se déconnecter" onPress={confirmLogout} danger />
          </View>
        </View>

        <View style={{ height: insets.bottom + (Platform.OS === "web" ? 34 : 90) }} />
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1 },
    header: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: { fontSize: 20, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      margin: 12,
      padding: 16,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 14,
    },
    avatar: { width: 56, height: 56, borderRadius: 28 },
    displayName: { fontSize: 16, fontWeight: "700" as const, color: colors.foreground, fontFamily: "Inter_700Bold" },
    username: { fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 },
    email: { fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 },
    repoBadge: { alignItems: "center" },
    repoBadgeNum: { fontSize: 20, fontWeight: "700" as const, color: colors.accent, fontFamily: "Inter_700Bold" },
    repoBadgeLabel: { fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
    section: { marginHorizontal: 12, marginBottom: 8 },
    sectionTitle: {
      fontSize: 11,
      color: colors.mutedForeground,
      fontFamily: "Inter_600SemiBold",
      letterSpacing: 0.8,
      marginBottom: 8,
      marginLeft: 4,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    divider: { height: 1, backgroundColor: colors.border },
  });
}
