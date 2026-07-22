import colors from "@/constants/colors";

export type Colors = typeof colors.dark & { radius: number };

// Gitcrush is always dark — matches the Gitcrush aesthetic
export function useColors(): Colors {
  return { ...colors.dark, radius: colors.radius };
}
