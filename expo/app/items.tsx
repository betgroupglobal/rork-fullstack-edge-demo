import { router } from "expo-router";
import { Check, Loader, Package, Pencil, Plus, Trash2, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import FadeIn from "@/components/FadeIn";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useCreateItem, useDeleteItem, useItems, useUpdateItem } from "@/hooks/useGateway";
import type { Item } from "@/lib/api";

function ItemRow({ item, index, authHeader }: { item: Item; index: number; authHeader?: string }) {
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
              <Pressable onPress={cancel} style={({ pressed }) => [styles.editBtn, styles.editBtnCancel, pressed && styles.pressed]}>
                <X size={12} color={theme.colors.textDim} />
                <Text style={[styles.editBtnText, { color: theme.colors.textDim }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={update.isPending} style={({ pressed }) => [styles.editBtn, styles.editBtnSave, pressed && styles.pressed]}>
                {update.isPending ? <ActivityIndicator size="small" color={theme.colors.bg} /> : <Check size={12} color={theme.colors.bg} />}
                <Text style={styles.editBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.rowMain}>
              <View style={styles.rowIcon}>
                <Package size={14} color={theme.colors.accent} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                {item.description ? <Text style={styles.rowDescription} numberOfLines={2}>{item.description}</Text> : null}
              </View>
            </View>
            <View style={styles.rowActions}>
              <Pressable onPress={() => setEditing(true)} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
                <Pencil size={14} color={theme.colors.textDim} />
              </Pressable>
              <Pressable onPress={removeItem} disabled={remove.isPending} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
                <Trash2 size={14} color={theme.colors.danger} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </FadeIn>
  );
}

export default function ItemsScreen() {
  const insets = useSafeAreaInsets();
  const ah = useApiKey();
  const { data, isLoading, isError, error, refetch } = useItems();
  const create = useCreateItem(ah);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const items = data?.items ?? [];

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Enter a name for the item.");
      return;
    }
    setFormError(null);
    create.mutate(
      { name: trimmed, description: description.trim() },
      { onSuccess: () => { setName(""); setDescription(""); } },
    );
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing(6), paddingBottom: insets.bottom + theme.spacing(6) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
            <Text style={styles.eyebrow}>ITEMS MANAGER</Text>
            <Text style={styles.hero}>{items.length} stored</Text>
            <Text style={styles.sub}>Add, rename, edit, and delete stored items. These are kept in the gateway Durable Object.</Text>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.stateCard}>
            <Package size={28} color={theme.colors.textFaint} />
            <Text style={styles.stateText}>No items yet. Add one below to start tracking stored data.</Text>
          </View>
        )}
        renderItem={({ item, index }) => <ItemRow item={item} index={index} authHeader={ah} />}
        ListFooterComponent={(
          <View style={styles.form}>
            <Text style={styles.formLabel}>NEW ITEM</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Item name"
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              onSubmitEditing={submit}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Description (optional)"
              placeholderTextColor={theme.colors.textFaint}
              style={styles.input}
              multiline
            />
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <PressableScale haptic="heavy" onPress={submit} disabled={create.isPending} style={[styles.addBtn, create.isPending && styles.addBtnBusy]}>
              {create.isPending ? <Loader size={16} color={theme.colors.bg} /> : <Plus size={16} color={theme.colors.bg} />}
              <Text style={styles.addBtnText}>{create.isPending ? "Adding…" : "Add item"}</Text>
            </PressableScale>
          </View>
        )}
      />

      {isLoading && items.length === 0 ? (
        <View style={[styles.overlay, { paddingTop: insets.top + theme.spacing(6) }]}>
          <View style={styles.stateCard}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.stateText}>Loading items…</Text>
          </View>
        </View>
      ) : null}

      {isError ? (
        <View style={[styles.overlay, { paddingTop: insets.top + theme.spacing(6) }]}>
          <OfflineCard message={error?.message ?? "Could not load items."} onRetry={() => refetch()} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  content: { paddingHorizontal: theme.spacing(4), gap: theme.spacing(4) },
  header: { gap: theme.spacing(1.5), marginBottom: theme.spacing(2) },
  back: { alignSelf: "flex-start", marginBottom: theme.spacing(2) },
  backText: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
  eyebrow: { color: theme.colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2, fontFamily: theme.font.mono },
  hero: { color: theme.colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  sub: { color: theme.colors.textDim, fontSize: 13, lineHeight: 20 },
  stateCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(6), gap: theme.spacing(3), alignItems: "center" },
  stateText: { color: theme.colors.textDim, fontSize: 14, lineHeight: 21, textAlign: "center" },
  row: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(3) },
  rowMain: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
  rowIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: theme.colors.bgElevated, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  rowDescription: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
  rowActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: theme.spacing(2) },
  iconBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: theme.colors.bgElevated, alignItems: "center", justifyContent: "center" },
  editPanel: { gap: theme.spacing(2) },
  fieldLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono },
  input: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(3), color: theme.colors.text, fontSize: 14 },
  editActions: { flexDirection: "row", gap: theme.spacing(2), justifyContent: "flex-end" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing(1.5), borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing(3), paddingVertical: theme.spacing(2) },
  editBtnCancel: { backgroundColor: theme.colors.surfaceAlt },
  editBtnSave: { backgroundColor: theme.colors.accent },
  editBtnText: { color: theme.colors.bg, fontSize: 12, fontWeight: "800" },
  form: { backgroundColor: theme.colors.bgElevated, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing(4), gap: theme.spacing(2), marginTop: theme.spacing(2) },
  formLabel: { color: theme.colors.textFaint, fontSize: 10, fontWeight: "700", letterSpacing: 1, fontFamily: theme.font.mono, marginTop: theme.spacing(1) },
  formError: { color: theme.colors.danger, fontSize: 12 },
  addBtn: { marginTop: theme.spacing(3), backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, paddingVertical: theme.spacing(3.5), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing(2) },
  addBtnBusy: { opacity: 0.7 },
  addBtnText: { color: theme.colors.bg, fontSize: 14, fontWeight: "800" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing(4), justifyContent: "flex-start" },
  pressed: { opacity: 0.55 },
});
