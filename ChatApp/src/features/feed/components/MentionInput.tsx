import { forwardRef } from "react";
import { StyleSheet, Text, TextInput, type TextInputProps } from "react-native";

import { colors } from "../../../design";
import { lookupMention, splitMentions, type MentionDirectory } from "../mentions";

type MentionInputProps = Omit<TextInputProps, "value" | "children"> & {
  value: string;
  directory: MentionDirectory;
};

/**
 * Editable TextInput that tints confirmed `@mentions` in the accent blue while
 * you type — the live counterpart to the read-only {@link MentionText}.
 *
 * It feeds the text in as styled <Text> children rather than the `value` prop
 * (the standard React Native technique for inline-styled input). The raw string
 * is still owned by the parent and updated through `onChangeText`; the parent
 * must also drive `selection` so the caret survives the child re-render. Only
 * tokens that resolve to a real user in `directory` are highlighted, so a freshly
 * picked or fully-typed handle goes blue and arbitrary "@text" stays plain.
 */
export const MentionInput = forwardRef<TextInput, MentionInputProps>(function MentionInput(
  { value, directory, style, ...props },
  ref,
) {
  const segments = splitMentions(value, (token) => Boolean(lookupMention(directory, token)));

  return (
    <TextInput ref={ref} style={style} {...props}>
      {value.length > 0 ? (
        <Text>
          {segments.map((segment, index) =>
            segment.mention ? (
              <Text key={index} style={styles.mention}>
                {segment.text}
              </Text>
            ) : (
              <Text key={index}>{segment.text}</Text>
            ),
          )}
        </Text>
      ) : null}
    </TextInput>
  );
});

const styles = StyleSheet.create({
  mention: {
    color: colors.mention,
    fontWeight: "600",
  },
});
