import { Redirect } from "expo-router";

// L'onglet Home a été supprimé : la route index redirige vers Fichiers.
export default function Index() {
  return <Redirect href="/(tabs)/files" />;
}
