import { router } from "expo-router";
import { Loader, Plus } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
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

import ItemRow from "@/components/ItemRow";
import OfflineCard from "@/components/OfflineCard";
import PressableScale from "@/components/PressableScale";
import EmptyState from "@/components/EmptyState";
import { layout, card, type as typeStyles, form } from "@/constants/styles";
import { theme } from "@/constants/theme";
import { useApiKey } from "@/hooks/useApiKey";
import { useCreateItem, useItems } from "@/hooks/useGateway";

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
    if (!trimmed) { setFormError("Enter a name for the item."); return; }
    setFormError(null);
    create.mutate(
      { name: trimmed, description: description.trim() },
      { onSuccess: () => { setName(""); setDescription(""); } },
    );
  };

  return (
    <KeyboardAvoidingView style={layout.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[layout.contentFlat, { paddingTop: insets.top + theme.spacing(6), paddingBottom: insets.bottom + theme.spacing(6), gap: theme.spacing(4) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && { opacity: 0.55 }]}>
              <Text style={styles.backText}>← Back</Text>
            </Pressable>
            <Text style={typeStyles.eyebrow}>ITEMS MANAGER</Text>
            <Text style={typeStyles.hero}>{items.length} stored</Text>
            <Text style={typeStyles.sub}>Add, rename, edit, and delete stored items.</Text>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={<Plus size={26} color={theme.colors.accent} />}
            title="No items yet"
            subtitle="Add one below to start tracking stored data."
          />
        }
        renderItem={({ item, index }) => <ItemRow item={item} index={index} authHeader={ah} />}
        ListFooterComponent={(
          <View style={card.elevated}>
            <Text style={[form.label, { marginTop: theme.spacing(1) }]}>NEW ITEM</Text>
            <TextInput
              value={name} onChangeText={setName}
              placeholder="Item name" placeholderTextColor={theme.colors.textFaint}
              style={form.input} onSubmitEditing={submit}
            />
            <TextInput
              value={description} onChangeText={setDescription}
              placeholder="Description (optional)" placeholderTextColor={theme.colors.textFaint}
              style={form.input} multiline
            />
            {formError ? <Text style={form.error}>{formError}</Text> : null}
            <PressableScale haptic="heavy" onPress={submit} disabled={create.isPending} style={[form.submitBtn, create.isPending && { opacity: 0.7 }]}>
              {create.isPending ? <Loader size={16} color={theme.colors.bg} /> : <Plus size={16} color={theme.colors.bg} />}
              <Text style={form.submitText}>{create.isPending ? "Adding…" : "Add item"}</Text>
            </PressableScale>
          </View>
        )}
      />

      {isLoading && items.length === 0 ? (
        <View style={[styles.overlay, { paddingTop: insets.top + theme.spacing(6) }]}>
          <View style={card.state}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={typeStyles.stateText}>Loading items…</Text>
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
  header: { gap: theme.spacing(1.5), marginBottom: theme.spacing(2) },
  back: { alignSelf: "flex-start", marginBottom: theme.spacing(2) },
  backText: { color: theme.colors.accent, fontSize: 14, fontWeight: "700" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.bg, paddingHorizontal: theme.spacing(4), justifyContent: "flex-start" },
});
