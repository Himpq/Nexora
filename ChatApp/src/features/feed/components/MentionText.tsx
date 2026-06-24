import React from "react";

import { AppText, colors } from "../../../design";
import { lookupMention, splitMentions, type MentionDirectory } from "../mentions";

type MentionTextProps = React.ComponentProps<typeof AppText> & {
  content: string;
  /**
   * Set of real users. A `@token` is tinted only when it resolves to someone in
   * here — so "@gwlpq" lights up while "@anything" stays plain prose. Omit it
   * and nothing is highlighted.
   */
  directory?: MentionDirectory;
};

/**
 * Renders post / comment text with real `@mentions` tinted in the accent blue.
 * Everything else inherits the surrounding AppText variant + tone.
 */
export function MentionText({ content, directory, variant, style, ...rest }: MentionTextProps) {
  const text = String(content ?? "");
  if (!text) {
    return <AppText variant={variant} style={style} {...rest} />;
  }

  const segments = splitMentions(text, (token) => Boolean(lookupMention(directory, token)));

  return (
    <AppText variant={variant} style={style} {...rest}>
      {segments.map((segment, index) =>
        segment.mention ? (
          <AppText key={index} variant={variant} style={[style, styles.mention]}>
            {segment.text}
          </AppText>
        ) : (
          segment.text
        ),
      )}
    </AppText>
  );
}

const styles = {
  mention: {
    color: colors.mention,
    fontWeight: "600" as const,
  },
};
