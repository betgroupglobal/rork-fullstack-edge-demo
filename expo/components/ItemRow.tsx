import { Pencil, Trash2 } from "lucide-react-native";
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "@/constants/theme";
import type { Item } from "@/lib/api";

type ItemRowProps = {
  item: Item;
  index: number;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  deleting: boolean;
};

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A single saved item with entrance animation plus edit / delete actions. */
export default function ItemRow({
  item,
  index,
  onEdit,
  onDelete,
  deleting,
}: ItemRowProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 340,
      delay: Math.min(index * 50, 300),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View
      style={[
        styles.row,
        { opacity: deleting ? 0.4 : anim, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.idChip}>
        <Text style={styles.idText}>#{item.id}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {item.description ? (
          <Text style={styles.desc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={styles.meta}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => onEdit(item)}
          disabled={deleting}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          hitSlop={6}
        >
          <Pencil size={16} color={theme.colors.cyan} />
        </Pressable>
        <Pressable
          onPress={() => onDelete(item)}
          disabled={deleting}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          hitSlop={6}
        >
          <Trash2 size={16} color={theme.colors.danger} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
  },
  idChip: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: theme.spacing(1),
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  idText: {
    color: theme.colors.accent,
    fontSize: 12,
    fontFamily: theme.font.mono,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  desc: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  meta: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontFamily: theme.font.mono,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing(2),
  },
  action: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.92 }],
  },
});
