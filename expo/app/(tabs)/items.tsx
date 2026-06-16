import { LinearGradient } from "expo-linear-gradient";
import {
  AlertTriangle,
  Check,
  Database,
  Plus,
  RefreshCw,
  X,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ItemRow from "@/components/ItemRow";
import { theme } from "@/constants/theme";
import {
  useCreateItem,
  useDeleteItem,
  useItems,
  useUpdateItem,
} from "@/hooks/useGateway";
import type { Item } from "@/lib/api";

export default function ItemsScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, error, refetch, isFetching } = useItems();
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();

  const [editing, setEditing] = useState<Item | null>(null);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const resetForm = useCallback(() => {
    setEditing(null);
    setName("");
    setDescription("");
  }, []);

  const startEdit = useCallback((item: Item) => {
    setEditing(item);
    setName(item.name);
    setDescription(item.description);
  }, []);

  const submit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editing) {
      updateItem.mutate(
        { id: editing.id, name: trimmed, description: description.trim() },
        { onSuccess: resetForm },
      );
    } else {
      createItem.mutate(
        { name: trimmed, description: description.trim() },
        { onSuccess: resetForm },
      );
    }
  }, [name, description, editing, updateItem, createItem, resetForm]);

  const confirmDelete = useCallback(
    (item: Item) => {
      const run = () => deleteItem.mutate(item.id);
      if (Platform.OS === "web") {
        run();
        return;
      }
      Alert.alert("Delete item", `Remove "${item.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: run },
      ]);
    },
    [deleteItem],
  );

  const items = data?.items ?? [];
  const saving = createItem.isPending || updateItem.isPending;
  const canSubmit = name.trim().length > 0 && !saving;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.accentGlow, "transparent"]}
        start={{ x: 0.8, y: 0 }}
        end={{ x: 0.2, y: 0.5 }}
        style={styles.glow}
        pointerEvents="none"
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + theme.spacing(6) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>/api/items</Text>
              <Text style={styles.title}>Items</Text>
            </View>
            <Pressable
              onPress={() => refetch()}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              hitSlop={8}
            >
              {isFetching ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <RefreshCw size={16} color={theme.colors.accent} />
              )}
            </Pressable>
          </View>

          {/* Form */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {editing ? `Edit item #${editing.id}` : "New item"}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              returnKeyType="next"
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={theme.colors.textFaint}
              style={[styles.input, styles.inputMultiline]}
              multiline
            />
            <View style={styles.formActions}>
              {editing ? (
                <Pressable
                  onPress={resetForm}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    pressed && styles.pressed,
                  ]}
                >
                  <X size={16} color={theme.colors.textDim} />
                  <Text style={styles.ghostBtnText}>Cancel</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  !canSubmit && styles.primaryBtnDisabled,
                  pressed && canSubmit && styles.primaryBtnPressed,
                ]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={theme.colors.bg} />
                ) : editing ? (
                  <Check size={17} color={theme.colors.bg} />
                ) : (
                  <Plus size={17} color={theme.colors.bg} />
                )}
                <Text style={styles.primaryBtnText}>
                  {editing ? "Save changes" : "Add item"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* List states */}
          {isLoading ? (
            <View style={styles.state}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Loading items…</Text>
            </View>
          ) : isError ? (
            <View style={styles.state}>
              <AlertTriangle size={28} color={theme.colors.danger} />
              <Text style={styles.stateTitle}>Couldn&apos;t load items</Text>
              <Text style={styles.stateText}>
                {error?.message ?? "The gateway did not respond."}
              </Text>
              <Pressable
                onPress={() => refetch()}
                style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.state}>
              <Database size={28} color={theme.colors.textFaint} />
              <Text style={styles.stateTitle}>No items yet</Text>
              <Text style={styles.stateText}>
                Add your first item above. It saves to durable edge storage and
                survives refresh.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              <Text style={styles.listCount}>
                {items.length} item{items.length === 1 ? "" : "s"} ·{" "}
                {data?.meta.cache ?? "—"}
              </Text>
              {items.map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  onEdit={startEdit}
                  onDelete={confirmDelete}
                  deleting={deleteItem.isPending && deleteItem.variables === item.id}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  flex: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 280 },
  content: {
    paddingHorizontal: theme.spacing(5),
    paddingBottom: theme.spacing(12),
    gap: theme.spacing(4),
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: 13,
    fontFamily: theme.font.mono,
    letterSpacing: 0.5,
  },
  title: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6, transform: [{ scale: 0.95 }] },
  formCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  formTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  input: {
    backgroundColor: theme.colors.bg,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(3),
    color: theme.colors.text,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  formActions: {
    flexDirection: "row",
    gap: theme.spacing(2),
    justifyContent: "flex-end",
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(1),
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  ghostBtnText: { color: theme.colors.textDim, fontWeight: "600", fontSize: 14 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.sm,
  },
  primaryBtnPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  primaryBtnDisabled: { backgroundColor: theme.colors.accentDim, opacity: 0.5 },
  primaryBtnText: { color: theme.colors.bg, fontWeight: "800", fontSize: 15 },
  state: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing(2),
    paddingVertical: theme.spacing(10),
    paddingHorizontal: theme.spacing(6),
  },
  stateTitle: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginTop: theme.spacing(1),
  },
  stateText: {
    color: theme.colors.textDim,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: theme.spacing(2),
    paddingHorizontal: theme.spacing(5),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  retryText: { color: theme.colors.accent, fontWeight: "700" },
  list: { gap: theme.spacing(3) },
  listCount: {
    color: theme.colors.textFaint,
    fontSize: 12,
    fontFamily: theme.font.mono,
    letterSpacing: 0.5,
  },
});
