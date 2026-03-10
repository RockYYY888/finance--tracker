import { useEffect, useRef, useState } from "react";
import { toErrorMessage } from "../lib/apiClient";
import type { AssetCollectionActions } from "../types/assets";

type IdentifiableRecord = {
	id: number;
};

export interface UseAssetCollectionOptions<TInput, TRecord extends IdentifiableRecord> {
	initialItems?: TRecord[];
	actions?: AssetCollectionActions<TInput, TRecord>;
	createLocalRecord: (payload: TInput, nextId: number) => TRecord | null;
	updateLocalRecord: (current: TRecord, payload: TInput) => TRecord;
}

export interface UseAssetCollectionResult<TInput, TRecord extends IdentifiableRecord> {
	items: TRecord[];
	errorMessage: string | null;
	isEditorOpen: boolean;
	editorMode: "create" | "edit" | null;
	editingRecord: TRecord | null;
	editingRecordId: number | null;
	editorSeedRecord: TRecord | null;
	editorSessionKey: number;
	isRefreshing: boolean;
	isSubmitting: boolean;
	openCreate: () => void;
	openEdit: (record: TRecord) => void;
	closeEditor: () => void;
	clearError: () => void;
	refresh: () => Promise<void>;
	submit: (payload: TInput) => Promise<void>;
	remove: (record: TRecord) => Promise<void>;
}

function getNextLocalId<TRecord extends IdentifiableRecord>(items: TRecord[]): number {
	if (items.length === 0) {
		return 1;
	}

	const maxRecordId = Math.max(...items.map((item) => item.id));
	return maxRecordId + 1;
}

/**
 * Keeps list state, editor state, and CRUD fallbacks in one place.
 */
export function useAssetCollection<TInput, TRecord extends IdentifiableRecord>(
	options: UseAssetCollectionOptions<TInput, TRecord>,
): UseAssetCollectionResult<TInput, TRecord> {
	const initialItems = options.initialItems ?? [];
	const [items, setItems] = useState<TRecord[]>(initialItems);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isEditorOpen, setIsEditorOpen] = useState(false);
	const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
	const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
	const [editorSeedRecord, setEditorSeedRecord] = useState<TRecord | null>(null);
	const [editorSessionKey, setEditorSessionKey] = useState(0);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const nextLocalIdRef = useRef(getNextLocalId(initialItems));
	const hydratedSignatureRef = useRef(JSON.stringify(initialItems));

	useEffect(() => {
		const nextSignature = JSON.stringify(initialItems);
		if (hydratedSignatureRef.current === nextSignature) {
			return;
		}

		hydratedSignatureRef.current = nextSignature;
		setItems(initialItems);
		nextLocalIdRef.current = Math.max(
			nextLocalIdRef.current,
			getNextLocalId(initialItems),
		);
	}, [initialItems]);

	const editingRecord =
		editingRecordId === null
			? null
			: items.find((item) => item.id === editingRecordId) ?? null;

	function openCreate(): void {
		setErrorMessage(null);
		setEditorMode("create");
		setEditingRecordId(null);
		setEditorSeedRecord(null);
		setEditorSessionKey((currentKey) => currentKey + 1);
		setIsEditorOpen(true);
	}

	function openEdit(record: TRecord): void {
		setErrorMessage(null);
		setEditorMode("edit");
		setEditingRecordId(record.id);
		setEditorSeedRecord(record);
		setEditorSessionKey((currentKey) => currentKey + 1);
		setIsEditorOpen(true);
	}

	function closeEditor(): void {
		setErrorMessage(null);
		setEditorMode(null);
		setEditingRecordId(null);
		setEditorSeedRecord(null);
		setIsEditorOpen(false);
	}

	function clearError(): void {
		setErrorMessage(null);
	}

	async function refresh(): Promise<void> {
		if (!options.actions?.onRefresh) {
			return;
		}

		setIsRefreshing(true);
		setErrorMessage(null);

		try {
			const nextItems = await options.actions.onRefresh();
			setItems(nextItems);
			nextLocalIdRef.current = Math.max(
				nextLocalIdRef.current,
				getNextLocalId(nextItems),
			);
		} catch (error) {
			setErrorMessage(toErrorMessage(error, "加载资产失败，请稍后重试。"));
		} finally {
			setIsRefreshing(false);
		}
	}

	async function submit(payload: TInput): Promise<void> {
		setIsSubmitting(true);
		setErrorMessage(null);

		try {
			if (editingRecordId !== null) {
				if (editingRecord === null) {
					throw new Error("当前记录已失效，请重新进入后重试。");
				}

				const optimisticRecord = options.updateLocalRecord(editingRecord, payload);
				setItems((currentItems) =>
					currentItems.map((item) =>
						item.id === optimisticRecord.id ? optimisticRecord : item,
					),
				);

				let nextRecord = optimisticRecord;
				try {
					nextRecord = options.actions?.onEdit
						? await options.actions.onEdit(editingRecord.id, payload)
						: optimisticRecord;
				} catch (error) {
					setItems((currentItems) =>
						currentItems.map((item) =>
							item.id === editingRecord.id ? editingRecord : item,
						),
					);
					throw error;
				}

				setItems((currentItems) =>
					currentItems.map((item) =>
						item.id === nextRecord.id ? nextRecord : item,
					),
				);
			} else {
				const optimisticRecord = options.createLocalRecord(
					payload,
					nextLocalIdRef.current++,
				);
				if (optimisticRecord) {
					setItems((currentItems) => [optimisticRecord, ...currentItems]);
				}

				let nextRecord = optimisticRecord;
				try {
					nextRecord = options.actions?.onCreate
						? await options.actions.onCreate(payload)
						: optimisticRecord;
				} catch (error) {
					if (optimisticRecord) {
						setItems((currentItems) =>
							currentItems.filter((item) => item.id !== optimisticRecord.id),
						);
					}
					throw error;
				}

				if (nextRecord) {
					setItems((currentItems) => {
						const existingRecordWithServerId = currentItems.find((item) =>
							item.id === nextRecord.id &&
							item.id !== optimisticRecord?.id
						);

						if (existingRecordWithServerId) {
							return currentItems
								.filter((item) => item.id !== optimisticRecord?.id)
								.map((item) => (item.id === nextRecord.id ? nextRecord : item));
						}

						if (optimisticRecord) {
							return currentItems.map((item) =>
								item.id === optimisticRecord.id ? nextRecord : item,
							);
						}

						return [nextRecord, ...currentItems];
					});
				} else if (optimisticRecord) {
					setItems((currentItems) =>
						currentItems.filter((item) => item.id !== optimisticRecord.id),
					);
				}
			}

			closeEditor();
		} catch (error) {
			setErrorMessage(
				toErrorMessage(
					error,
					editingRecordId === null
						? "创建记录失败，请稍后重试。"
						: "保存修改失败，请稍后重试。",
				),
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	async function remove(record: TRecord): Promise<void> {
		setIsSubmitting(true);
		setErrorMessage(null);

		try {
			setItems((currentItems) =>
				currentItems.filter((item) => item.id !== record.id),
			);

			const wasEditingCurrentRecord = editingRecordId === record.id;
			if (wasEditingCurrentRecord) {
				setEditorMode(null);
				setEditingRecordId(null);
				setIsEditorOpen(false);
			}

			try {
				if (options.actions?.onDelete) {
					await options.actions.onDelete(record.id);
				}
			} catch (error) {
				setItems((currentItems) => [record, ...currentItems]);
				if (wasEditingCurrentRecord) {
					setEditorMode("edit");
					setEditingRecordId(record.id);
					setIsEditorOpen(true);
				}
				throw error;
			}
		} catch (error) {
			setErrorMessage(toErrorMessage(error, "删除记录失败，请稍后重试。"));
		} finally {
			setIsSubmitting(false);
		}
	}

	return {
		items,
		errorMessage,
		isEditorOpen,
		editorMode,
		editingRecord,
		editingRecordId,
		editorSeedRecord,
		editorSessionKey,
		isRefreshing,
		isSubmitting,
		openCreate,
		openEdit,
		closeEditor,
		clearError,
		refresh,
		submit,
		remove,
	};
}
