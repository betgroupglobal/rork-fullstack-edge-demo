import { Check, Loader, Pencil, Trash2, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/constants/theme";
import { useDeleteItem, useUpdateItem } from "@/hooks/useGateway";
import type { Item } from "@/lib/api";
import FadeIn from "./FadeIn";

type ItemRowProps = { item: Item; index: number; authHeader?: string };

/** Single item row with inline edit and delete. */
export default function ItemRow({ item, index, authHeader }: ItemRowProps) {
  const update = useUpdateItem(authHeader);
  const remove = useDeleteItem(authHeader);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    update.mutate(
      { id: item.id, name: trimmed, description: description.trim() },
      { onSuccess: () => setEditing(false) },
    );
  };

  const cancel = () => {
    setName(item.name);
    setDescription(item.description);
    setEditing(false);
  };

  const removeItem = () => {
    const run = () => remove.mutate(item.id);
    if (Platform.OS === "web") {
      run();
      return;
    }
    Alert.alert("Delete item", `Remove "${item.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: run },
    ]);
  };

  return (
    <FadeIn delay={index * 60}>
      <View style={styles.row}>
        {editing ? (
          <View style={styles.editPanel}>
            <Text style={styles.fieldLabel}>NAME</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="Item name"
              placeholderTextColor={theme.colors.textFaint}
              autoFocus
            />
            <Text style={styles.fieldLabel}>DESCRIPTION</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              style={styles.input}
              placeholder="Description"
              placeholderTextColor={theme.colors.textFaint}
              multiline
            />
            <View style={styles.editActions}>
              <Pressable
                onPress={cancel}
                style={({ pressed }) => [
                  styles.editBtn,
                  styles.editBtnCancel,
                  pressed && styles.pressed,
                ]}
              >
                <X size={12} color={theme.colors.textDim} />
                <Text style={[styles.editBtnText, { color: theme.colors.textDim }]}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={update.isPending}
                style={({ pressed }) => [
                  styles.editBtn,
                  styles.editBtnSave,
                  pressed && styles.pressed,
                ]}
              >
                {update.isPending ? (
                  <ActivityIndicator size="small" color={theme.colors.bg} />
                ) : (
                  <Check size={12} color={theme.colors.bg} />
                )}
                <Text style={styles.editBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.rowMain}>
              <View style={styles.rowIcon}>
                <Loader size={14} color={theme.colors.accent} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={styles.rowDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.rowActions}>
              <Pressable
                onPress={() => setEditing(true)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Pencil size={14} color={theme.colors.textDim} />
              </Pressable>
              <Pressable
                onPress={removeItem}
                disabled={remove.isPending}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.iconBtn,
                  pressed && styles.pressed,
                ]}
              >
                <Trash2 size={14} color={theme.colors.danger} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  rowDescription: {
    color: theme.colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing(2),
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: theme.colors.bgElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  editPanel: { gap: theme.spacing(2) },
  fieldLabel: {
    color: theme.colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: theme.font.mono,
  },
  input: {
    backgroundColor: theme.colors.bgElevated,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 14,
  },
  editActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
    justifyContent: "flex-end",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1.5),
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  editBtnCancel: { backgroundColor: theme.colors.surfaceAlt },
  editBtnSave: { backgroundColor: theme.colors.accent },
  editBtnText: { color: theme.colors.bg, fontSize: 12, fontWeight: "800" },
  pressed: { opacity: 0.55 },
});
