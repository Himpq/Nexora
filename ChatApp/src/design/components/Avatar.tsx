import { useEffect, useState } from "react";
import { Image, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

import { resolveAvatarUrl } from "../../services/imageService";
import { colors } from "../tokens";
import { AppText } from "./AppText";

type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<AvatarSize, number> = {
  sm: 28,
  md: 36,
  lg: 44,
  xl: 56,
};

const TEXT_SIZE_MAP: Record<AvatarSize, number> = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
};

type AvatarProps = {
  /** Avatar image URL (relative or absolute). When falsy or load fails, fallback initial is shown. */
  uri?: string | null;
  /** Display name used to derive the initial fallback. */
  name?: string | null;
  /** Predefined size token. Overridden by `style.width` / `style.height`. */
  size?: AvatarSize;
  /** Optional style override (mainly for sizing tweaks). */
  style?: StyleProp<ViewStyle>;
};

function getInitial(name?: string | null) {
  const text = String(name || "").trim();
  if (!text) return "?";
  // Use Array.from to handle surrogate pairs correctly (CJK/emoji).
  return (Array.from(text)[0] || "?").toUpperCase();
}

export function Avatar({ uri, name, size = "md", style }: AvatarProps) {
  const dimension = SIZE_MAP[size] ?? SIZE_MAP.md;
  const fontSize = TEXT_SIZE_MAP[size] ?? TEXT_SIZE_MAP.md;
  const resolvedUri = resolveAvatarUrl(uri);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [resolvedUri]);

  const baseStyle: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: dimension / 2,
  };

  if (resolvedUri && !errored) {
    return (
      <View style={[styles.container, baseStyle, style]}>
        <Image
          source={{ uri: resolvedUri }}
          onError={() => setErrored(true)}
          style={[styles.image, baseStyle as ImageStyle]}
          accessibilityLabel={name ? `${name} avatar` : undefined}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.fallback, baseStyle, style]}>
      <AppText style={[styles.fallbackText, { fontSize }]}>{getInitial(name)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  fallback: {
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    justifyContent: "center",
  },
  fallbackText: {
    color: colors.textInverse,
    fontWeight: "700",
    includeFontPadding: false,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
