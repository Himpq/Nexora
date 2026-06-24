import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { AssistantPanel } from "./AssistantPanel";
import { FloatingBubble } from "./FloatingBubble";
import type { ReaderContext } from "./types";

/**
 * Overlay that hosts the reading assistant: a draggable book bubble that opens
 * a draggable/resizable panel (导读 / AI / 测验 / 知识点 / 进度). Once opened
 * the panel stays mounted (hidden) so AI conversations and tab state survive
 * close/reopen. `box-none` lets touches fall through except on the bubble/panel.
 */
export function FloatingAssistant({ context }: { context: ReaderContext }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  if (!context.lectureId || !context.bookId) {
    return null;
  }

  const openPanel = () => {
    setEverOpened(true);
    setOpen(true);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {everOpened ? (
        <AssistantPanel open={open} onClose={() => setOpen(false)} context={context} />
      ) : null}
      {!open ? <FloatingBubble onPress={openPanel} /> : null}
    </View>
  );
}
