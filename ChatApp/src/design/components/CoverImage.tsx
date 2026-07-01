import React, { useEffect, useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { resolveLearningAssetUrl } from "../../services/imageService";
import { colors, radius } from "../tokens";

type CoverImageProps = {
  /** Cover URL (`/api/...` relative paths are resolved automatically). */
  uri?: string | null;
  /** Optional fallback icon when no cover is available or it fails to load. */
  fallbackIcon?: keyof typeof Feather.glyphMap;
  /** Container style (controls width/height/aspect-ratio). */
  style?: StyleProp<ViewStyle>;
  /** Override the rendered image style; rarely needed. */
  imageStyle?: StyleProp<ImageStyle>;
  /** Border radius of the cover surface. Defaults to `radius.md`. */
  borderRadius?: number;
  /** `cover` (default) crops to fill, `contain` preserves the full image. */
  resizeMode?: "cover" | "contain";
  /** Optional element rendered above the image (e.g. play badge). */
  overlay?: React.ReactNode;
  accessibilityLabel?: string;
};

export function CoverImage({
  uri,
  fallbackIcon = "image",
  style,
  imageStyle,
  borderRadius,
  resizeMode = "cover",
  overlay,
  accessibilityLabel,
}: CoverImageProps) {
  const resolvedUri = resolveLearningAssetUrl(uri);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [resolvedUri]);

  const containerStyle: ViewStyle = {
    borderRadius: borderRadius ?? radius.md,
  };

  if (resolvedUri && !errored) {
    return (
      <View style={[styles.container, containerStyle, style]}>
        <Image
          source={{ uri: resolvedUri }}
          onError={() => setErrored(true)}
          resizeMode={resizeMode}
          accessibilityLabel={accessibilityLabel}
          style={[styles.image, imageStyle]}
        />
        {overlay ? <View style={styles.overlay}>{overlay}</View> : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.fallback, containerStyle, style]}>
      <Feather name={fallbackIcon} size={20} color={colors.textInverse} />
      {overlay ? <View style={styles.overlay}>{overlay}</View> : null}
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
  image: {
    width: "100%",
    height: "100%",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
